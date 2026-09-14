/**
 * Shared helpers for the agent "Web UI" feature.
 *
 * Two things every agent route needs and that are easy to get subtly wrong:
 *
 *   1. A portable "is the Web UI serving, and on which interface?" probe.
 *   2. The Local Relay direct-transfer handshake (`webui-ctl` op `relay-start`).
 *
 * (2) is ~90 lines of ordering-sensitive code — register the ack waiter BEFORE
 * sending, distinguish a relay-reported failure (502) from a timeout (504), and
 * never send the relay the monitor's own rewritten SSH endpoint. It was written
 * out by hand in the hermes and nanobot routes; this module is the single copy
 * new routes use so the two behaviours cannot drift.
 *
 * NOTE: hermes and nanobot still carry their own inline copies. They work and
 * are heavily exercised, so they are deliberately left alone — migrating them
 * is a separate, testable change.
 */

/**
 * Shell fragment that prints `HTTP_CODE=<code>` and `BIND=<address>` for a
 * loopback-dialled port.
 *
 * A 2xx/3xx/4xx means something is SERVING (401/403 just means auth is on);
 * only connection-refused (000) means the UI is down. The bind address tells
 * the caller whether the UI is reachable ONLY on the target's loopback — which
 * is what decides if the same-origin "Via server" proxy is the right route.
 *
 * `ss` and `netstat` are both absent from minimal images (the fc-fedora40 test
 * container has neither), so `/proc/net/tcp` is the last resort. Without it a
 * loopback-bound dashboard looks "not loopback" and the UI silently hides the
 * only route that works from a phone.
 */
export function webUIProbeShell(port) {
  const p = parseInt(port, 10) > 0 ? parseInt(port, 10) : 0;
  return `
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:${p}/" 2>/dev/null || true)
BB=""
if command -v ss >/dev/null 2>&1; then BB=$(ss -tln 2>/dev/null | awk '$4 ~ /:${p}$/ {print $4; exit}'); fi
if [ -z "$BB" ] && command -v netstat >/dev/null 2>&1; then BB=$(netstat -tln 2>/dev/null | awk '$4 ~ /:${p}$/ {print $4; exit}'); fi
if [ -z "$BB" ] && [ -r /proc/net/tcp ]; then
  HEXP=$(printf '%04X' ${p})
  RAW=$(awk -v h="$HEXP" '$4 == "0A" { n = split($2, a, ":"); if (a[n] == h) { print a[1]; exit } }' /proc/net/tcp 2>/dev/null)
  case "$RAW" in
    00000000) BB="0.0.0.0" ;;
    0100007F) BB="127.0.0.1" ;;
    "") ;;
    *) BB="0x$RAW" ;;
  esac
fi
echo "HTTP_CODE=$HTTP_CODE"
echo "BIND=$(echo "$BB" | sed 's/:[0-9]*$//')"
`;
}

/**
 * Parse `webUIProbeShell` output.
 * @returns {{ code: number, bind: string|null, active: boolean, loopback: boolean }}
 */
export function parseWebUIProbe(stdout) {
  const code = parseInt((stdout || '').match(/HTTP_CODE=(\d+)/)?.[1] || '0', 10);
  const raw = (stdout || '').match(/BIND=(.*)/)?.[1]?.trim() || '';
  const bind = raw ? String(raw).replace(/^\[/, '').replace(/\]$/, '') : null;
  return {
    code,
    bind,
    active: code >= 200 && code < 500,
    loopback: !!bind && (/^127\./.test(bind) || bind === '::1' || bind === 'localhost'),
  };
}

/**
 * Open a Local Relay tunnel to an agent's Web UI port.
 *
 * Direct-transfer mode: the relay opens the SSH tunnel on the user's OWN
 * machine and serves the dashboard at 127.0.0.1:<localPort>. The central
 * server is control-plane only — no dashboard bytes flow through it.
 *
 * @param {object}   o
 * @param {object}   o.session         NextAuth session (userId/dbId/sub are used to address the relay).
 * @param {string}   o.connectionId    Connection id (also the forwardId key).
 * @param {number}   o.remotePort      Port the Web UI listens on, ON the target server.
 * @param {number}   o.localPortHint   Requested local port — a HINT only. If another
 *                                     gateway already owns it the relay binds the next
 *                                     free port and reports the real one via `webui:ready`.
 * @param {string}   o.monitorOrigin   Origin the relay should echo back for CORS/absolute-URL fixes.
 * @param {string}   [o.bootstrapSecret] Secret the relay injects so the SPA can auto-pair
 *                                     (nanobot needs this; hermes/zeroclaw/openclaw do not).
 * @param {string}   [o.preferredRelay] Pin the tunnel to a specific relay when the user has several.
 * @param {Function} o.getSshConfig    The route's own `getSshConfig` (bound to that route's options).
 * @param {string[]} [o.log]           Live-log array to append to.
 * @returns {Promise<{status:number, body:object}>} Ready to hand to NextResponse.json(body, {status}).
 */
export async function startWebuiRelayTunnel({
  session, connectionId, remotePort, localPortHint, monitorOrigin,
  bootstrapSecret = '', preferredRelay, getSshConfig, log = [],
}) {
  if (typeof global.__sendToRelayForUserAny !== 'function') {
    return { status: 503, body: { success: false, error: 'relay bridge unavailable', log } };
  }

  const forwardId = `${connectionId}-${remotePort}`;

  // The route's `sshConfig` is resolved for the CURRENT request mode. In local
  // mode that may already point at the monitor's own relay listener
  // (127.0.0.1:<forwarder-port>). Do NOT send that rewritten endpoint to the
  // user's machine: it must SSH to the connection's original target, not back
  // into the monitor server.
  const relayConnection = await getSshConfig(connectionId, {
    userId: session?.user?.id,
    role: session?.user?.role,
    sshMode: 'server',
    skipRelayResolution: true,
  });

  const forwardMsg = {
    type: 'webui:forward',
    forwardId,
    remotePort,
    localPort: localPortHint,
    monitorOrigin,
    bootstrapSecret,
    connection: {
      host: relayConnection.host,
      port: relayConnection.port,
      username: relayConnection.username,
      password: relayConnection.password,
      privateKey: relayConnection.privateKey,
      passphrase: relayConnection.passphrase,
    },
  };

  // Register the waiter BEFORE sending, or the relay's ack can arrive before
  // we are listening and we would wait out the full timeout.
  const ackPromise = typeof global.__waitForWebuiForward === 'function'
    ? global.__waitForWebuiForward(forwardId, 20000)
    : Promise.resolve(null);

  const sent = await (
    global.__sendToRelayForUserAny(
      [session?.user?.id, session?.user?.dbId, session?.user?.sub],
      forwardMsg,
      preferredRelay,
    ) || Promise.resolve(false)
  );
  if (!sent) {
    return {
      status: 409,
      body: { success: false, error: 'Local Relay is not connected — start it or use the central proxy', log },
    };
  }

  const ack = await ackPromise;
  const localPort = Number(ack?.port) || 0;

  // No port means the tunnel never came up, and there are two very different
  // reasons — conflating them (as an earlier version did) tells the user to
  // check whether Local Relay is running even when the relay is connected and
  // already said what went wrong:
  //   • 'webui:fail' — the relay IS connected and told us why (SSH refused,
  //     the dashboard port dead, ports exhausted). Answer 502, quote it.
  //   • a genuine timeout — no relay at all, or one too old to answer. 504,
  //     and the "is Local Relay running?" text is correct.
  if (!localPort) {
    if (ack?.error) {
      log.push(`✗ [webui] Local Relay could not open the tunnel: ${ack.error}`);
      return {
        status: 502,
        body: {
          success: false,
          portConfirmed: false,
          error: `Local Relay could not open the Web UI tunnel: ${ack.error}`,
          log,
        },
      };
    }
    log.push('✗ [webui] Local Relay never confirmed the tunnel (timed out)');
    return {
      status: 504,
      body: {
        success: false,
        portConfirmed: false,
        error: 'Local Relay did not confirm the Web UI tunnel. Check that Local Relay is running on your computer and can reach this server over SSH.',
        log,
      },
    };
  }

  log.push(`> [webui] Direct relay requested — dashboard serving at http://127.0.0.1:${localPort}`);
  return {
    status: 200,
    body: { success: true, active: true, relay: true, localPort, portConfirmed: true, log },
  };
}
