# Multi-Relay Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple Local Relay Agents to run simultaneously across different machines for the same user account.

**Architecture:** Change `__activeRelays` from `Map<userId, relay>` to `Map<userId, Map<relayId, relay>>`. Each relay identifies itself with a hostname. SSH connections store `relayName` for routing. Fallback to any available relay when no match.

**Tech Stack:** Node.js, WebSocket (ws), Socket.io, MongoDB

---

### Task 1: Update local-relay.js to send relay identity

**Covers:** S1 (relay identification)

**Files:**
- Modify: `public/local-relay.js:146-155`

- [ ] **Step 1: Add hostname detection and --name flag support**

In `public/local-relay.js`, after the config loading section (~line 70), add:

```js
const RELAY_NAME = args.name || savedConfig.name || os.hostname();
```

Update `saveConfig` call at line 87 to include name:

```js
saveConfig({ server: SERVER, token: TOKEN, name: RELAY_NAME });
```

- [ ] **Step 2: Send relayName in init message**

At line 153, change the init message from:

```js
ws.send(JSON.stringify({ type: 'init', capabilities: { ssh: !!ssh2, sftp: !!ssh2, docker: true } }));
```

To:

```js
ws.send(JSON.stringify({ type: 'init', relayName: RELAY_NAME, capabilities: { ssh: !!ssh2, sftp: !!ssh2, docker: true } }));
```

- [ ] **Step 3: Log relay name on startup**

At line 154, update the log to include the name:

```js
console.log(`✅ Relay ready! Name: ${RELAY_NAME}, Capabilities: SSH=${!!ssh2}, SFTP=${!!ssh2}, Docker=true`);
```

- [ ] **Step 4: Commit**

```bash
git add public/local-relay.js
git commit -m "feat(relay): send relayName identity in init message"
```

---

### Task 2: Update server.js relay storage to support multiple relays per user

**Covers:** S2 (storage change)

**Files:**
- Modify: `server.js:3323` (initialization)
- Modify: `server.js:3427-3443` (registration)
- Modify: `server.js:3460-3468` (init handler)
- Modify: `server.js:3570-3593` (disconnect handler)

- [ ] **Step 1: Change `__activeRelays` comment to reflect new structure**

At line 3323, change:

```js
global.__activeRelays = global.__activeRelays || new Map(); // userId → {localPort, netServer, targetHost, targetPort, ws, capabilities}
```

To:

```js
global.__activeRelays = global.__activeRelays || new Map(); // userId → Map<relayId, {localPort, netServer, targetHost, targetPort, ws, capabilities, relayName}>
```

- [ ] **Step 2: Track relayName from init message**

The `relayName` is received in the `init` message handler. At line 3460-3468, change:

```js
if (msg.type === 'init') {
  const r = global.__activeRelays.get(userId);
  if (r) {
    r.targetHost = msg.targetHost || 'localhost';
    r.targetPort = Number(msg.targetPort) || 27017;
    r.capabilities = msg.capabilities || { ssh: false, sftp: false, docker: false };
    r.ws = ws;
  }
}
```

To:

```js
if (msg.type === 'init') {
  const userRelays = global.__activeRelays.get(userId);
  const relayId = msg.relayName || 'default';
  const r = userRelays?.get(relayId);
  if (r) {
    r.targetHost = msg.targetHost || 'localhost';
    r.targetPort = Number(msg.targetPort) || 27017;
    r.capabilities = msg.capabilities || { ssh: false, sftp: false, docker: false };
    r.ws = ws;
    r.relayName = relayId;
  }
}
```

- [ ] **Step 3: Update relay registration to use nested Map**

At lines 3427-3443, change the `netServer.listen` callback. Before the current registration code, we need the relayName from init. Since init comes AFTER registration, we store with a temporary key and update on init.

Actually, the init message arrives AFTER the `ready` message. Let me restructure:

At line 3441, change:

```js
global.__activeRelays.set(userId, { localPort, netServer, ws, targetHost: 'localhost', targetPort: 27017, capabilities: {} });
```

To:

```js
if (!global.__activeRelays.has(userId) || !(global.__activeRelays.get(userId) instanceof Map)) {
  global.__activeRelays.set(userId, new Map());
}
// Use a temporary relayId until init message provides the real name
const tempRelayId = `relay-${Date.now()}`;
const userRelays = global.__activeRelays.get(userId);

// Close any existing relays for this user that have the same temp ID (shouldn't happen, but safety)
const relayEntry = { localPort, netServer, ws, targetHost: 'localhost', targetPort: 27017, capabilities: {}, relayName: tempRelayId };
userRelays.set(tempRelayId, relayEntry);

// Store tempRelayId on ws so init handler can find and rename it
ws.__relayId = tempRelayId;
```

- [ ] **Step 4: Update init handler to rename relayId**

At lines 3460-3468, update to handle renaming:

```js
if (msg.type === 'init') {
  const userRelays = global.__activeRelays.get(userId);
  if (!userRelays) return;

  const oldRelayId = ws.__relayId;
  const newRelayId = msg.relayName || oldRelayId || 'default';

  let r = userRelays.get(oldRelayId);
  if (r) {
    // If name changed, move to new key
    if (oldRelayId !== newRelayId) {
      userRelays.delete(oldRelayId);
      // Close duplicate if one already exists with this name
      const existing = userRelays.get(newRelayId);
      if (existing?.netServer) {
        try { existing.netServer.close(); } catch {}
      }
      userRelays.set(newRelayId, r);
      ws.__relayId = newRelayId;
    }
    r.targetHost = msg.targetHost || 'localhost';
    r.targetPort = Number(msg.targetPort) || 27017;
    r.capabilities = msg.capabilities || { ssh: false, sftp: false, docker: false };
    r.ws = ws;
    r.relayName = newRelayId;
  }
}
```

- [ ] **Step 5: Update disconnect handler to use nested Map**

At lines 3570-3593, change:

```js
ws.on('close', () => {
  clearInterval(serverPingTimer);
  netServer.close();
  const current = global.__activeRelays.get(userId);
  if (current && current.netServer === netServer) {
    global.__activeRelays.delete(userId);
    // ... flush logic
  }
  // ...
  console.log(`🔗 [Relay] Disconnected: user ${userId}`);
});
```

To:

```js
ws.on('close', () => {
  clearInterval(serverPingTimer);
  netServer.close();
  const relayId = ws.__relayId;
  const userRelays = global.__activeRelays.get(userId);
  if (userRelays instanceof Map) {
    const current = userRelays.get(relayId);
    if (current && current.netServer === netServer) {
      userRelays.delete(relayId);
      if (userRelays.size === 0) {
        global.__activeRelays.delete(userId);
      }
      try {
        const { flushRelayPooledConnections } = require('./src/lib/dbPool');
        flushRelayPooledConnections('relay websocket closed').catch(() => {});
        import('./src/lib/mongodb.js').then(({ flushRelayDynamicConnections }) => {
          flushRelayDynamicConnections('relay websocket closed');
        }).catch(() => {});
      } catch (_) {}
    }
  }
  tcpSockets.forEach(s => s.destroy());
  console.log(`🔗 [Relay] Disconnected: user ${userId}, relay ${relayId}`);
});
```

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(relay): support multiple relays per user via nested Map"
```

---

### Task 3: Update findActiveRelay and related functions in sshTunnel.js

**Covers:** S3 (routing)

**Files:**
- Modify: `src/lib/sshTunnel.js:148-161` (findActiveRelay)
- Modify: `src/lib/sshTunnel.js:212-231` (resolveLocalhostViaRelay)

- [ ] **Step 1: Update findActiveRelay to support relayId**

Change `findActiveRelay` at line 148:

```js
export function findActiveRelay(userId, relayId) {
  if (!global.__activeRelays?.size) return null;

  if (userId) {
    const userRelays = global.__activeRelays.get(userId);
    if (userRelays instanceof Map) {
      // Try specific relay first
      if (relayId && userRelays.has(relayId)) {
        return { relay: userRelays.get(relayId), userId, relayId };
      }
      // Fall back to first available relay for this user
      if (userRelays.size > 0) {
        const [rid, relay] = userRelays.entries().next().value;
        return { relay, userId, relayId: rid };
      }
    } else if (userRelays && !(userRelays instanceof Map)) {
      // Backward compat: old format (single relay, not a Map)
      return { relay: userRelays, userId, relayId: null };
    }
  }

  // Fallback: find any relay across all users (single-user setups)
  if (global.__activeRelays.size === 1) {
    const [uid, userRelays] = global.__activeRelays.entries().next().value;
    if (userRelays instanceof Map && userRelays.size > 0) {
      const [rid, relay] = userRelays.entries().next().value;
      return { relay, userId: uid, relayId: rid };
    } else if (userRelays && !(userRelays instanceof Map)) {
      return { relay: userRelays, userId: uid, relayId: null };
    }
  }

  return null;
}
```

- [ ] **Step 2: Update resolveLocalhostViaRelay to pass relayId**

Change `resolveLocalhostViaRelay` at line 212 to accept and pass `relayId`:

```js
export function resolveLocalhostViaRelay(host, port, userId, relayId) {
  if (!isLocalHost(host)) return { host, port, usedRelay: false };

  const found = findActiveRelay(userId, relayId);
  if (!found?.relay?.localPort) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ [Relay] No active relay — using server localhost (development only)');
      return { host, port, usedRelay: false };
    }
    throw new Error(
      'Local Relay Agent is not connected. Install and start local-relay.js on your machine, then retry.'
    );
  }

  applyRelayTarget(found.relay, host, port);
  console.log(
    `🔗 Relay: routing ${found.relay.targetHost}:${found.relay.targetPort} → 127.0.0.1:${found.relay.localPort}` +
    ` (relay: ${found.relayId || 'any'})`
  );
  return { host: '127.0.0.1', port: found.relay.localPort, usedRelay: true, relayId: found.relayId };
}
```

- [ ] **Step 3: Update normalizeRelayDatabaseUri to handle nested Map**

Change `normalizeRelayDatabaseUri` at line 182 to iterate nested maps:

```js
export function normalizeRelayDatabaseUri(uri) {
  if (!uri || !/localhost|127\.0\.0\.1/.test(uri)) return uri;
  if (!global.__activeRelays?.size) return uri;

  try {
    const url = new URL(uri);
    const uriPort = parseInt(url.port, 10);
    if (!uriPort) return uri;

    for (const userRelays of global.__activeRelays.values()) {
      const relays = userRelays instanceof Map ? userRelays.values() : [userRelays];
      for (const relay of relays) {
        if (!relay) continue;
        if (uriPort === relay.localPort) {
          const restoredPort =
            relay.targetPort && relay.targetPort !== relay.localPort
              ? relay.targetPort
              : 27017;
          url.port = String(restoredPort);
          console.log(
            `🔧 [Relay] Normalized URI port ${uriPort} → ${restoredPort} (relay proxy port)`
          );
          return url.toString();
        }
      }
    }
  } catch {}

  return uri;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/sshTunnel.js
git commit -m "feat(relay): update routing functions for multi-relay support"
```

---

### Task 4: Update mongodb.js and dbPool.js for multi-relay

**Covers:** S3 (routing)

**Files:**
- Modify: `src/lib/mongodb.js:76-102` (getActiveRelayInfo)
- Modify: `src/lib/dbPool.js:32-34` (resolveRelayForLocalhost)

- [ ] **Step 1: Update getActiveRelayInfo in mongodb.js**

Change `getActiveRelayInfo` at line 76:

```js
export async function getActiveRelayInfo(uri) {
  if (!global.__activeRelays?.size) return null;

  uri = normalizeRelayDatabaseUri(uri);

  try {
    const url = new URL(uri);
    const host = url.hostname;
    if (!/localhost|127\.0\.0\.1/.test(host)) return null;

    const { getToken } = require('next-auth/jwt');
    let token;
    try {
      token = await getToken({ req: { headers: { cookie: '' } }, secret: process.env.NEXTAUTH_SECRET });
    } catch {}
    const userId = token?.sub;

    const found = findActiveRelay(userId);
    if (!found?.relay) return null;

    const remoteHost = url.hostname;
    const remotePort = parseInt(url.port, 10) || 27017;

    applyRelayTarget(found.relay, remoteHost, remotePort);

    return { port: found.relay.localPort, userId: found.userId, relayId: found.relayId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update resolveRelayForLocalhost in dbPool.js**

No change needed — it already delegates to `resolveLocalhostViaRelay` which we updated in Task 3. The `relayId` will flow through automatically.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mongodb.js
git commit -m "feat(relay): update getActiveRelayInfo for multi-relay"
```

---

### Task 5: Update relay token API for multi-relay status

**Covers:** S4 (API)

**Files:**
- Modify: `src/app/api/relay/token/route.js:40-58` (GET handler)
- Modify: `src/app/api/relay/token/route.js:64-89` (DELETE handler)

- [ ] **Step 1: Update GET to return all active relays**

Change the GET handler at line 40:

```js
export async function GET(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = token.sub;
    const userRelays = global.__activeRelays?.get(userId);

    if (userRelays instanceof Map) {
      const relays = [];
      for (const [relayId, relay] of userRelays) {
        relays.push({
          relayId,
          connected: true,
          localPort: relay.localPort,
          capabilities: relay.capabilities || { ssh: false, sftp: false, docker: false },
          relayName: relay.relayName || relayId,
        });
      }
      return Response.json({
        success: true,
        connected: relays.length > 0,
        relays,
      });
    }

    // Backward compat: single relay (not a Map)
    const relay = userRelays;
    return Response.json({
      success: true,
      connected: !!relay,
      relays: relay ? [{
        relayId: relay.relayName || 'default',
        connected: true,
        localPort: relay.localPort,
        capabilities: relay.capabilities || { ssh: false, sftp: false, docker: false },
        relayName: relay.relayName || 'default',
      }] : [],
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update DELETE to close all relays for user**

Change the DELETE handler at line 64:

```js
export async function DELETE(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = token.sub;

    // Revoke tokens
    global.__relayTokens = global.__relayTokens || new Map();
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === userId) global.__relayTokens.delete(t);
    }

    // Close all active relays for this user
    const userRelays = global.__activeRelays?.get(userId);
    if (userRelays instanceof Map) {
      for (const [relayId, relay] of userRelays) {
        try { relay.netServer?.close(); } catch {}
      }
      global.__activeRelays.delete(userId);
    } else if (userRelays) {
      try { userRelays.netServer?.close(); } catch {}
      global.__activeRelays.delete(userId);
    }

    if (typeof global.__persistRelayTokens === 'function') global.__persistRelayTokens();
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/relay/token/route.js
git commit -m "feat(relay): update relay token API for multi-relay status"
```

---

### Task 6: Update SSH routing in server.js to use relayName

**Covers:** S3 (routing)

**Files:**
- Modify: `server.js:2960-2962` (SSH handler relay lookup)
- Modify: `server.js:3069-3074` (relay SSH routing)

- [ ] **Step 1: Update userRelay lookup to support relayName**

At line 2960-2962, change:

```js
const isLocalhost = /localhost|127\.0\.0\.1/.test(sshConfig.host);
const userId = socket.user?.sub || socket.user?.dbId;
const userRelay = userId ? global.__activeRelays?.get(userId) : null;
```

To:

```js
const isLocalhost = /localhost|127\.0\.0\.1/.test(sshConfig.host);
const userId = socket.user?.sub || socket.user?.dbId;
const userRelays = userId ? global.__activeRelays?.get(userId) : null;
// Find the best relay: prefer one matching the connection's relayName, else first available
let userRelay = null;
if (userRelays instanceof Map) {
  const connRelayName = connection?.relayName;
  userRelay = (connRelayName && userRelays.get(connRelayName)) || (userRelays.size > 0 ? userRelays.values().next().value : null);
} else if (userRelays) {
  userRelay = userRelays; // backward compat
}
```

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat(relay): route SSH to correct relay by relayName"
```

---

### Task 7: Update SettingsApp to show multi-relay status

**Covers:** S5 (UI)

**Files:**
- Modify: `src/apps/SettingsApp.js:164-170` (relay state)
- Modify: `src/apps/SettingsApp.js` (relay status display)

- [ ] **Step 1: Update relay state to handle array of relays**

Find the relay status fetch in SettingsApp and update to handle the new API response format. The GET `/api/relay/token` now returns `{ relays: [...] }`.

In the relay status check useEffect, update:

```js
// When fetching relay status, use the new relays array
const data = await res.json();
setRelayConnected(data.connected);
// data.relays is now an array of { relayId, connected, localPort, capabilities, relayName }
```

- [ ] **Step 2: Display active relays list in Settings UI**

In the relay section of SettingsApp, show each active relay:

```jsx
{relayConnected && relays.length > 0 && (
  <div className="space-y-1">
    {relays.map(r => (
      <div key={r.relayId} className="flex items-center gap-2 text-[11px]">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="font-mono">{r.relayName}</span>
        <span className="opacity-50">:{r.localPort}</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/apps/SettingsApp.js
git commit -m "feat(relay): show multi-relay status in settings UI"
```

---

### Task 8: Update deploy webhook for multi-relay

**Covers:** S3 (routing)

**Files:**
- Modify: `src/app/api/deploy/webhook/route.js:464-467`

- [ ] **Step 1: Update relay lookup in deploy webhook**

At line 464-467, change:

```js
const activeRelays = global.__activeRelays;
if (activeRelays && activeRelays.size > 0) {
  relay = Array.from(activeRelays.values())[0];
```

To:

```js
const activeRelays = global.__activeRelays;
if (activeRelays && activeRelays.size > 0) {
  const userRelays = activeRelays.values().next().value;
  if (userRelays instanceof Map && userRelays.size > 0) {
    relay = userRelays.values().next().value;
  } else if (userRelays && !(userRelays instanceof Map)) {
    relay = userRelays;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/deploy/webhook/route.js
git commit -m "feat(relay): update deploy webhook for multi-relay"
```

---

### Task 9: Update server.js localhost normalization for multi-relay

**Covers:** S3 (routing)

**Files:**
- Modify: `server.js:148-190` (normalizeRelayDatabaseUri and resolveLocalhostViaRelay)

- [ ] **Step 1: Update server.js copy of normalizeRelayDatabaseUri**

At line 154-170, update the server.js inline version to iterate nested Maps:

```js
if (!global.__activeRelays?.size) return uri;
// ... existing try block ...
for (const userRelays of global.__activeRelays.values()) {
  const relays = userRelays instanceof Map ? userRelays.values() : [userRelays];
  for (const relay of relays) {
    if (!relay) continue;
    // ... existing port matching logic ...
  }
}
```

- [ ] **Step 2: Update server.js resolveLocalhostViaRelay**

At line 179-190, update to handle nested Map:

```js
if (!global.__activeRelays?.size) return uri;
// ...
let relay = userId ? global.__activeRelays.get(userId) : null;
if (relay instanceof Map) {
  relay = relay.size > 0 ? relay.values().next().value : null;
}
if (!relay && global.__activeRelays.size === 1) {
  const allRelays = global.__activeRelays.values().next().value;
  if (allRelays instanceof Map && allRelays.size > 0) {
    relay = allRelays.values().next().value;
  } else if (allRelays && !(allRelays instanceof Map)) {
    relay = allRelays;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(relay): update server.js localhost normalization for multi-relay"
```

---

### Task 10: Test multi-relay scenario

**Covers:** All

- [ ] **Step 1: Start server and verify no errors**

```bash
npm run dev
```

Expected: Server starts without errors, logs show "Local Relay Agent: ready"

- [ ] **Step 2: Test with a single relay (backward compat)**

Run local-relay.js from one machine. Verify:
- Relay connects and shows name in logs
- SSH connections work as before
- GET /api/relay/token returns `{ relays: [{ relayName: "hostname" }] }`

- [ ] **Step 3: Test with two relays**

Run local-relay.js from two machines with same token. Verify:
- Both relays show in GET /api/relay/token
- SSH connections route to the correct relay based on relayName
- Disconnecting one relay doesn't affect the other

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: multi-relay support - multiple relay agents per user"
```
