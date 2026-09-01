#!/usr/bin/env node
/**
 * Grant or revoke the admin role on a user account.
 *
 * Why this exists:
 *   Admin authorization is now driven purely by the persisted `role: 'admin'`
 *   field on the user document — ADMIN_EMAIL no longer grants route access on
 *   its own. That is the correct security posture, but it means an account
 *   that previously relied on the email fallback has NO admin access until its
 *   role is persisted. This script is the recovery path for that lockout.
 *
 * Usage:
 *   node scripts/set-admin-role.js --list
 *   node scripts/set-admin-role.js --email you@example.com
 *   node scripts/set-admin-role.js --email you@example.com --revoke
 *
 * Notes:
 *   - The target account must already exist (sign in once first).
 *   - MongoDB credentials are read from MONGODB_URI (or a local .env file).
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Minimal .env reader so this script works standalone — `dotenv` is not a
// project dependency and we do not want to add one just for a rescue tool.
// Only sets variables that are not already present in the environment.
function loadEnvIfPresent() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  let parsed = 0;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      parsed++;
    }
  }
  if (parsed > 0) console.log(`Loaded ${parsed} variable(s) from .env`);
}

loadEnvIfPresent();

const MONGODB_URI = process.env.MONGODB_URI;

function parseArgs(argv) {
  const args = { email: null, revoke: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--email':
      case '-e':
        args.email = (argv[++i] || '').trim();
        break;
      case '--revoke':
        args.revoke = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  node scripts/set-admin-role.js --list
  node scripts/set-admin-role.js --email <email>
  node scripts/set-admin-role.js --email <email> --revoke
`);
}

function redact(uri) {
  return String(uri).replace(/\/\/[^/@]*@/, '//****:****@');
}

async function listAdmins(db) {
  const admins = await db.collection('users').find({ role: 'admin' }, { projection: { email: 1, role: 1 } }).toArray();
  const total = await db.collection('users').countDocuments({});
  console.log(`\nTotal users: ${total}`);
  console.log(`Users with role 'admin': ${admins.length}`);
  if (admins.length === 0) {
    console.log('\n  (none — /api/admin/* is currently unreachable for every account)');
  } else {
    admins.forEach((a) => console.log(`  - ${a.email}`));
  }
  const roles = await db.collection('users').distinct('role');
  console.log(`\nDistinct roles present: ${JSON.stringify(roles)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    return 0;
  }

  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Export it or add it to .env.');
    return 1;
  }

  if (!args.list && !args.email) {
    usage();
    return 1;
  }

  console.log('Connecting to:', redact(MONGODB_URI));
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  try {
    if (args.list) {
      await listAdmins(db);
      return 0;
    }

    const email = args.email.toLowerCase();
    const user = await db.collection('users').findOne(
      { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { projection: { email: 1, role: 1 } }
    );

    if (!user) {
      console.error(`\nNo user found with email: ${args.email}`);
      console.error('The account must exist first — sign in once, then re-run this script.');
      return 1;
    }

    const nextRole = args.revoke ? 'user' : 'admin';

    if (String(user.role || 'user') === nextRole) {
      console.log(`\n${user.email} already has role '${nextRole}' — nothing to do.`);
      return 0;
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { role: nextRole } }
    );

    console.log(`\n${args.revoke ? 'Revoked' : 'Granted'} admin on: ${user.email}`);
    console.log(`  role: ${user.role || 'user'}  ->  ${nextRole}`);
    console.log('\nThe change is read from the database on every admin request,');
    console.log('so no restart is required. The affected user may need to sign');
    console.log('out and back in if their session was created before this change.');

    await listAdmins(db);
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
