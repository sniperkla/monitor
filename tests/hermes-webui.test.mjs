import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Hermes Web UI (dashboard) wiring.
 *
 * Hermes ships its own browser dashboard; monitor's job is to start it, detect
 * it and proxy it — exactly like nanobot's WebUI. These tests lock in the three
 * things that are easy to get wrong:
 *   1. `hermes serve` is HEADLESS (answers "/" with "web UI disabled"), so the
 *      UI must come from `hermes dashboard`.
 *   2. The dashboard is killed BY PORT, never by `pkill -f hermes` (that would
 *      take the messaging gateway and sibling instances down too).
 *   3. The shell snippets live inside JS template literals, so a stray
 *      backtick in a comment silently terminates the string.
 */

const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
const app = readFileSync('src/apps/AIAgentsApp.js', 'utf8');
const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

test('hermes web UI uses `hermes dashboard`, never the headless `hermes serve`', () => {
  const webui = section(route, "if (action === 'webui-ctl')", "// ── HEALTH");
  assert.match(webui, /dashboard --port \$\{wuPort\} --no-open/);
  // `hermes serve` serves "web UI disabled — use `hermes dashboard`" at "/".
  assert.doesNotMatch(webui, /serve --port/);
  // Detached + logged so a slow first launch (frontend build) is survivable.
  assert.match(webui, /nohup \$\{sq\(BIN\)\} dashboard/);
  assert.match(webui, /< \/dev\/null &/);
  // Readiness is polled, not assumed — the port is bound minutes after spawn
  // on a cold box because the dashboard compiles its own frontend first.
  assert.match(webui, /for i in \$\(seq 1 40\)/);
  assert.match(webui, /HTTP_CODE=/);
});

test('hermes web UI stop targets the port, not the hermes process name', () => {
  const webui = section(route, "if (action === 'webui-ctl')", "// ── HEALTH");
  // Killing by name would also kill the gateway and every sibling instance.
  assert.doesNotMatch(webui, /pkill[^\n]*hermes/);
  assert.doesNotMatch(webui, /killall[^\n]*hermes/);
  assert.match(webui, /fuser -k \$\{wuPort\}\/tcp/);
  assert.match(webui, /lsof -ti :\$\{wuPort\}/);
});

test('hermes web UI gets a per-instance port with 9119 as the default', () => {
  assert.match(route, /const WEBUI_PORT = instancePorts\('hermes', inst, \['webui'\]\)\[0\] \|\| 9119;/);
  // The relay forwards to a port nanobot's 18790 does not collide with.
  const webui = section(route, "if (action === 'webui-ctl')", "// ── HEALTH");
  assert.match(webui, /localPort: 18791/);
});

test('hermes details reports the dashboard as a live-probed Web UI', () => {
  const details = section(route, "if (action === 'details')", "if (action === 'save-prompt')");
  assert.match(details, /hasWebUI: installed/);
  assert.match(details, /webUIPort: WEBUI_PORT/);
  assert.match(details, /webUIActive/);
  // webUIActive must come from an HTTP probe, not a process listing: the
  // gateway is a unix socket, so there is no other way to tell.
  assert.match(details, /WU_HTTP=/);
  assert.match(details, /webuiHttp >= 200 && webuiHttp < 500/);

  // Regression: this block sits inside a JS template literal. A backtick — even
  // in a comment — terminates the string and breaks the whole route.
  const probe = section(details, 'echo "===WEBUI==="', 'echo "===VERSION==="');
  assert.doesNotMatch(probe, /`/);
  assert.match(probe, /127\.0\.0\.1:\$\{WEBUI_PORT\}/);
});

test('hermes joins nanobot in the Web UI quick-launch card', () => {
  // The list is the single gate for both the Start button and the Local Relay
  // direct-transfer path, so every agent in it gets both. It grew from
  // ['nanobot','hermes'] to cover zeroclaw and openclaw; assert membership
  // rather than the literal array so adding an agent does not need a test edit.
  const startList = /const WEBUI_START_AGENTS = \[([^\]]*)\]/.exec(app);
  assert.ok(startList, 'WEBUI_START_AGENTS must be declared');
  const ids = startList[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  for (const id of ['nanobot', 'hermes', 'zeroclaw', 'openclaw']) {
    assert.ok(ids.includes(id), `${id} must be in WEBUI_START_AGENTS`);
  }
  assert.match(app, /WEBUI_START_AGENTS\.includes\(agent\.id\)/);
  assert.match(app, /WEBUI_START_AGENTS\.includes\(agentRef\.current\?\.id\)/);

  // Port fallback must be per-agent. A shared map replaced the old
  // `agent.id === 'hermes' ? 9119 : 8765` ternary — that ternary silently gave
  // every new agent nanobot's port, which is exactly the bug this pins against.
  const portMap = /const WEBUI_DEFAULT_PORT = \{([^}]*)\}/.exec(app);
  assert.ok(portMap, 'WEBUI_DEFAULT_PORT map must exist');
  for (const [id, port] of [['hermes', 9119], ['nanobot', 8765], ['zeroclaw', 42617], ['openclaw', 18789]]) {
    assert.match(portMap[1], new RegExp(`${id}:\\s*${port}`), `${id} fallback port must be ${port}`);
  }
  assert.doesNotMatch(app, /agent\.id === 'hermes' \? 9119 : 8765/);
});

test('webui-ctl stop returns a response instead of falling off the block', () => {
  // `stop` is the one op that matches no launch branch (start/restart/relay-start),
  // so a stop handler without an explicit return silently returns `undefined` —
  // a 500 inline, and "Cannot read properties of undefined" as a live job.
  for (const [name, src] of [['hermes', route], ['nanobot', readFileSync('src/app/api/agents/nanobot/route.js', 'utf8')]]) {
    // End marker must be the NEXT section's banner: slicing to another
    // "if (action === '" would just re-match the webui-ctl heading itself and
    // yield an empty string.
    const block = section(src, "if (action === 'webui-ctl')", '// ── HEALTH');
    assert.ok(block.length > 500, `${name}: webui-ctl block not found`);
    const stop = block.slice(block.indexOf("if (op === 'stop'"));
    const stopBranch = stop.slice(0, stop.indexOf("if (op === 'relay-start')"));
    assert.match(stopBranch, /return NextResponse\.json/, `${name}: webui-ctl stop must return`);
    // The return must be the plain-stop one, not the restart fall-through.
    assert.match(stopBranch, /if \(op === 'stop'\)/, `${name}: stop return must be guarded`);
  }
});

test('webui-ctl restart still reaches the launcher after the stop fix', () => {
  // The stop fix puts a `return` inside the kill block that stop and restart
  // SHARE. If that return were unguarded, restart would kill the Web UI and
  // never re-launch it — "restart" would silently mean "stop".
  for (const [name, src] of [['hermes', route], ['nanobot', readFileSync('src/app/api/agents/nanobot/route.js', 'utf8')]]) {
    const block = section(src, "if (action === 'webui-ctl')", '// ── HEALTH');
    assert.match(block, /if \(op === 'stop' \|\| op === 'restart'\)/, `${name}: kill block must cover restart too`);
    const guard = block.indexOf("if (op === 'stop') {");
    assert.ok(guard >= 0, `${name}: guarded stop return missing`);
    // A launch path must survive after the guard, or restart has nowhere to go.
    assert.match(block.slice(guard), /nohup/, `${name}: launcher must come after the stop return`);
  }
});

test('the Web UI card offers a Stop control only while the UI is serving', () => {
  assert.match(app, /data-stop-webui-btn/);
  assert.match(app, /onClick=\{handleStopWebUI\}/);
  // Gated on both: an agent whose Web UI is a SEPARATE process, and a live
  // webUIActive probe. The card hoists the first half into `canStartStop` (it
  // gates the Start button too), so assert the definition AND the use —
  // otherwise this would pass on any truthy name.
  assert.match(app, /const canStartStop = WEBUI_START_AGENTS\.includes\(agent\.id\)/);
  assert.match(app, /const canStopWebUI = canStartStop && !WEBUI_IS_AGENT_PROCESS\.includes\(agent\.id\)/);
  assert.match(app, /canStopWebUI && details\?\.webUIActive/);
  // Refresh comes from callAction's own loadDetails(), so webUIActive re-probes.
  assert.match(app, /config: \{ op: 'stop', port: webUIPort\(\) \}/);
});

test('agents whose own daemon serves the dashboard get no Stop button', () => {
  // zeroclaw's `daemon` and openclaw's `gateway` serve their dashboard on the
  // SAME port they run their channels on — there is no separate webui process.
  // "Stop the Web UI" would therefore take the whole agent offline, which is
  // not what a Stop button next to a dashboard implies. The Overview tab's
  // Gateway controls own that action, where the consequence can be named.
  assert.match(app, /const WEBUI_IS_AGENT_PROCESS = \['zeroclaw', 'openclaw'\]/);
  // Every agent that can start a Web UI must be in one of the two buckets, and
  // the agent-process bucket must be a strict subset — a typo in either list
  // would silently either strand an agent or expose a destructive Stop.
  const startList = /const WEBUI_START_AGENTS = \[([^\]]*)\]/.exec(app)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const agentProc = /const WEBUI_IS_AGENT_PROCESS = \[([^\]]*)\]/.exec(app)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  for (const id of agentProc) {
    assert.ok(startList.includes(id), `${id} is in WEBUI_IS_AGENT_PROCESS but cannot start a Web UI`);
  }
  assert.ok(agentProc.length < startList.length, 'a strict subset is required for the Stop gate to mean anything');
});

test('webui proxy starts the right agent when the UI is down', () => {
  // The "connection refused" rescue screen used to hard-code /api/agents/nanobot.
  assert.doesNotMatch(proxy, /fetch\('\/api\/agents\/nanobot'/);
  assert.match(proxy, /searchParams\.get\('agent'\)/);
  assert.match(proxy, /fetch\('\/api\/agents\/\$\{agentId\}'/);
});
