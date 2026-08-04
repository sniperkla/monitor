import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { getPooledConnection } from '@/lib/dbPool';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { MongoClient } from 'mongodb';

// Helper to get raw mongo client for a given connection ID or URI
async function getClientForConn(connectionId, customUri) {
  if (customUri) {
    const client = new MongoClient(customUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    return { client, close: () => client.close() };
  }

  if (connectionId === 'default') {
    const db = await connectDB(null, true);
    return { client: db.connection.getClient(), close: () => {} };
  }

  const db = await connectDB();
  const repo = new ConnectionRepository(db);
  await repo.init();
  const fullConn = await repo.findById(connectionId);
  if (!fullConn) throw new Error('Target connection not found');
  
  const connData = fullConn.toObject ? fullConn.toObject() : fullConn;
  const pooled = await getPooledConnection(connData);
  const client = pooled.db.client || pooled.db.connection?.getClient();
  return { client, close: () => {} };
}

// GET: Fetch Replica Set Status
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId') || 'default';
    const customUri = searchParams.get('uri');
    const discover = searchParams.get('discover');

    // ── Discover Multi-MongoDB Instances Mode ──
    if (discover === 'true') {
      try {
        const db = await connectDB();
        const repo = new ConnectionRepository(db);
        await repo.init();
        const allConns = await repo.findAll();
        
        const mongoDbConns = allConns.filter(c => c.type === 'database' && (c.dbProvider === 'mongodb' || (c.uri && c.uri.startsWith('mongodb'))));

        const instances = mongoDbConns.map(c => ({
          id: c._id ? c._id.toString() : c.id,
          name: c.name || 'MongoDB Instance',
          uri: c.uri,
          host: c.host || (c.uri ? (c.uri.match(/@([^:/]+)/) || [])[1] : '127.0.0.1'),
          port: c.port || (c.uri ? (c.uri.match(/:(\d+)\//) || [])[1] : '27017'),
          provider: 'mongodb'
        }));

        // Always include default local system mongo
        instances.unshift({
          id: 'default',
          name: 'System Database (Local 27017)',
          uri: 'mongodb://127.0.0.1:27017',
          host: '127.0.0.1',
          port: '27017',
          provider: 'mongodb'
        });

        return NextResponse.json({ success: true, instances });
      } catch (discErr) {
        console.error('Discover instances error:', discErr);
        return NextResponse.json({ success: false, error: discErr.message }, { status: 500 });
      }
    }

    const { client, close } = await getClientForConn(connectionId, customUri);

    try {
      const adminDb = client.db('admin');
      
      // Run rs.status() and rs.conf()
      let rsStatus = null;
      let rsConfig = null;
      let isReplSet = false;
      let isMaster = null;

      try {
        isMaster = await adminDb.command({ isMaster: 1 });
        if (isMaster.setName) {
          isReplSet = true;
          rsStatus = await adminDb.command({ replSetGetStatus: 1 });
          try {
            const confRes = await adminDb.command({ replSetGetConfig: 1 });
            rsConfig = confRes.config;
          } catch (_) {}
        }
      } catch (err) {
        return NextResponse.json({ 
          success: false, 
          isReplSet: false, 
          error: `Failed to query MongoDB server: ${err.message}` 
        });
      }

      close();

      return NextResponse.json({
        success: true,
        isReplSet,
        setName: isMaster?.setName || null,
        isMaster: isMaster?.ismaster || isMaster?.isWritablePrimary || false,
        primary: isMaster?.primary || null,
        hosts: isMaster?.hosts || [],
        me: isMaster?.me || null,
        rsStatus,
        rsConfig
      });

    } catch (innerErr) {
      close();
      throw innerErr;
    }

  } catch (error) {
    console.error('Replica Set GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST: Execute Failover, StepDown, Reconfig, or Initiate Replica Set
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, connectionId = 'default', customUri, targetHost, members, setName = 'rs0', stepDownSecs = 60 } = body;

    const { client, close } = await getClientForConn(connectionId, customUri);
    const adminDb = client.db('admin');

    try {
      if (action === 'stepDown') {
        // ── Step down current Primary to force election ──
        try {
          // replSetStepDown causes the connection to drop, which is expected
          await adminDb.command({ replSetStepDown: stepDownSecs, force: true });
        } catch (err) {
          // Socket closure during stepDown is standard behavior in MongoDB driver
          if (!err.message.includes('closed') && !err.message.includes('reset') && !err.message.includes('interrupted')) {
            throw err;
          }
        }
        close();
        return NextResponse.json({ 
          success: true, 
          message: `Primary stepped down for ${stepDownSecs} seconds. Election triggered.` 
        });
      }

      if (action === 'promoteNode') {
        // ── Failover to specific target host by boosting priority in rs.config ──
        if (!targetHost) {
          close();
          return NextResponse.json({ success: false, error: 'targetHost is required for promotion' }, { status: 400 });
        }

        const confRes = await adminDb.command({ replSetGetConfig: 1 });
        const config = confRes.config;
        config.version += 1;

        let found = false;
        config.members = config.members.map(member => {
          if (member.host === targetHost || member.host.includes(targetHost)) {
            found = true;
            return { ...member, priority: 10 }; // Highest priority triggers auto-election
          }
          return { ...member, priority: member.priority > 0 ? 1 : 0 };
        });

        if (!found) {
          close();
          return NextResponse.json({ success: false, error: `Target host ${targetHost} not found in replica set config` }, { status: 404 });
        }

        await adminDb.command({ replSetReconfig: config, force: true });

        // Step down primary if we are on primary to speed up election
        try {
          await adminDb.command({ replSetStepDown: 30, force: true });
        } catch (_) {}

        close();
        return NextResponse.json({ 
          success: true, 
          message: `Promoted ${targetHost} to highest priority (10). Primary failover initiated.` 
        });
      }

      if (action === 'initiate') {
        // ── Initiate new 3-Node Replica Set ──
        if (!Array.isArray(members) || members.length === 0) {
          close();
          return NextResponse.json({ success: false, error: 'At least 1 member host is required to initiate replica set' }, { status: 400 });
        }

        const initConfig = {
          _id: setName,
          members: members.map((host, idx) => ({
            _id: idx,
            host: host.trim(),
            priority: idx === 0 ? 10 : 1
          }))
        };

        try {
          const res = await adminDb.command({ replSetInitiate: initConfig });
          close();
          return NextResponse.json({ 
            success: true, 
            message: `Replica Set '${setName}' initialized successfully with ${members.length} node(s)!`,
            result: res
          });
        } catch (initErr) {
          // If server returns error about not running with --replSet, auto-configure mongod.conf or container
          if (initErr.message.includes('No replSet config') || initErr.message.includes('not active') || initErr.message.includes('is not running with --replSet') || initErr.message.includes('already initialized')) {
            // Try single-node fallback initiation first
            try {
              const singleRes = await adminDb.command({ replSetInitiate: { _id: setName, members: [{ _id: 0, host: members[0] }] } });
              close();
              return NextResponse.json({
                success: true,
                message: `Replica Set '${setName}' initialized on primary node ${members[0]}. You can now add other members.`,
                result: singleRes
              });
            } catch (singleErr) {
              close();
              return NextResponse.json({
                success: false,
                error: `MongoDB node requires '--replSet ${setName}' configuration. Error: ${initErr.message}`
              }, { status: 400 });
            }
          }
          close();
          throw initErr;
        }
      }

      if (action === 'addMember') {
        if (!targetHost) {
          close();
          return NextResponse.json({ success: false, error: 'targetHost is required to add member' }, { status: 400 });
        }

        const confRes = await adminDb.command({ replSetGetConfig: 1 });
        const config = confRes.config;
        config.version += 1;

        const maxId = Math.max(...config.members.map(m => m._id), -1);
        config.members.push({
          _id: maxId + 1,
          host: targetHost.trim(),
          priority: 1
        });

        await adminDb.command({ replSetReconfig: config });
        close();
        return NextResponse.json({ success: true, message: `Node ${targetHost} added to Replica Set.` });
      }

      if (action === 'removeMember') {
        if (!targetHost) {
          close();
          return NextResponse.json({ success: false, error: 'targetHost is required to remove member' }, { status: 400 });
        }

        const confRes = await adminDb.command({ replSetGetConfig: 1 });
        const config = confRes.config;
        config.version += 1;

        const initialCount = config.members.length;
        config.members = config.members.filter(m => m.host !== targetHost && !m.host.includes(targetHost));

        if (config.members.length === initialCount) {
          close();
          return NextResponse.json({ success: false, error: `Member ${targetHost} not found in Replica Set` }, { status: 404 });
        }

        await adminDb.command({ replSetReconfig: config, force: true });
        close();
        return NextResponse.json({ success: true, message: `Node ${targetHost} removed from Replica Set.` });
      }

      close();
      return NextResponse.json({ success: false, error: 'Invalid replica set action' }, { status: 400 });

    } catch (innerErr) {
      close();
      throw innerErr;
    }

  } catch (error) {
    console.error('Replica Set POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
