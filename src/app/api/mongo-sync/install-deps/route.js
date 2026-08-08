import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig } from '@/app/api/server-backup/_ssh';
import { Client } from 'ssh2';

// Use array join instead of template literal to avoid JS parsing bash ${VAR} expressions
function buildInstallScript() {
  const s = [
    'set -uo pipefail',
    '',
    'log() { echo "[$(date \'+%H:%M:%S\')] $*"; }',
    '',
    'log "=== MongoSync Dependency Installer ==="',
    'log "Host: $(hostname)"',
    'log "User: $(whoami)"',
    'echo ""',
    '',
    'PKG=""',
    'if command -v apt-get > /dev/null 2>&1; then PKG="apt-get";',
    'elif command -v yum > /dev/null 2>&1; then PKG="yum";',
    'elif command -v dnf > /dev/null 2>&1; then PKG="dnf";',
    'fi',
    'if [ -n "$PKG" ]; then log "Package manager: $PKG"; else log "Package manager: none"; fi',
    '',
    'ARCH=$(uname -m)',
    'TMP_DIR="$HOME/.mongosync-scripts/tmp"',
    'mkdir -p "$TMP_DIR" "$HOME/.local/bin"',
    '',
    '# ── 1. mongoexport ────────────────────────────────────────────',
    'echo ""',
    'log "--- Checking mongoexport ---"',
    'EXPORT_BIN=""',
    'for _b in mongoexport "$HOME/.local/bin/mongoexport" /usr/local/bin/mongoexport /usr/bin/mongoexport; do',
    '  if command -v "$_b" > /dev/null 2>&1 || [ -x "$_b" ]; then',
    '    EXPORT_BIN="$_b"; break',
    '  fi',
    'done',
    '',
    'if [ -n "$EXPORT_BIN" ]; then',
    '  log "✅ Already installed: $EXPORT_BIN"',
    '  $EXPORT_BIN --version 2>&1 | head -1 | while read l; do log "   $l"; done',
    'else',
    '  log "❌ Not found. Installing..."',
    '  INSTALLED=false',
    '  if [ -n "$PKG" ] && command -v sudo > /dev/null 2>&1 && sudo -n true 2>/dev/null; then',
    '    log "   Running: sudo $PKG install -y mongodb-database-tools"',
    '    sudo $PKG install -y mongodb-database-tools 2>&1 | while read l; do log "   $l"; done || true',
    '    command -v mongoexport > /dev/null 2>&1 && INSTALLED=true && log "✅ Installed via $PKG"',
    '  fi',
    '  if [ "$INSTALLED" = "false" ]; then',
    '    log "   Trying user-local install..."',
    '    _URL="https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-$ARCH-100.10.0.tgz"',
    '    log "   Downloading: $_URL"',
    '    curl -fsSL "$_URL" -o "$TMP_DIR/mongodb-tools.tgz" 2>&1 | while read l; do log "   $l"; done',
    '    if [ -f "$TMP_DIR/mongodb-tools.tgz" ]; then',
    '      tar -xzf "$TMP_DIR/mongodb-tools.tgz" -C "$TMP_DIR" 2>&1 | while read l; do log "   $l"; done',
    '      find "$TMP_DIR" -name "mongoexport" -type f -exec cp {} "$HOME/.local/bin/mongoexport" \\;',
    '      chmod +x "$HOME/.local/bin/mongoexport" 2>/dev/null || true',
    '      rm -f "$TMP_DIR/mongodb-tools.tgz"',
    '      [ -x "$HOME/.local/bin/mongoexport" ] && log "✅ Installed to ~/.local/bin/mongoexport" || log "❌ Install failed"',
    '    else',
    '      log "❌ Download failed"',
    '    fi',
    '  fi',
    'fi',
    '',
    '# ── 2. mongosh ────────────────────────────────────────────────',
    'echo ""',
    'log "--- Checking mongosh ---"',
    'SHELL_BIN=""',
    'if command -v mongosh > /dev/null 2>&1; then SHELL_BIN="mongosh";',
    'elif command -v mongo > /dev/null 2>&1; then SHELL_BIN="mongo";',
    'elif [ -x "$HOME/.local/bin/mongosh" ]; then SHELL_BIN="$HOME/.local/bin/mongosh";',
    'fi',
    '',
    'if [ -n "$SHELL_BIN" ]; then',
    '  log "✅ Already installed: $SHELL_BIN"',
    '  $SHELL_BIN --version 2>&1 | head -1 | while read l; do log "   $l"; done',
    'else',
    '  log "❌ Not found. Installing..."',
    '  INSTALLED=false',
    '  if [ -n "$PKG" ] && command -v sudo > /dev/null 2>&1 && sudo -n true 2>/dev/null; then',
    '    log "   Running: sudo $PKG install -y mongodb-mongosh"',
    '    sudo $PKG install -y mongodb-mongosh 2>&1 | while read l; do log "   $l"; done || \\',
    '      sudo $PKG install -y mongodb-org-shell 2>&1 | while read l; do log "   $l"; done || true',
    '    (command -v mongosh > /dev/null 2>&1 || command -v mongo > /dev/null 2>&1) && INSTALLED=true && log "✅ Installed via $PKG"',
    '  fi',
    '  if [ "$INSTALLED" = "false" ]; then',
    '    log "   Trying user-local install..."',
    '    _URL="https://github.com/mongodb-js/mongosh/releases/download/v2.1.1/mongosh-2.1.1-linux-x64.tgz"',
    '    log "   Downloading: $_URL"',
    '    curl -fsSL "$_URL" -o "$TMP_DIR/mongosh.tgz" 2>&1 | while read l; do log "   $l"; done',
    '    if [ -f "$TMP_DIR/mongosh.tgz" ]; then',
    '      tar -xzf "$TMP_DIR/mongosh.tgz" -C "$TMP_DIR" 2>&1 | while read l; do log "   $l"; done',
    '      find "$TMP_DIR" -path "*/bin/mongosh" -type f -exec cp {} "$HOME/.local/bin/mongosh" \\;',
    '      chmod +x "$HOME/.local/bin/mongosh" 2>/dev/null || true',
    '      rm -f "$TMP_DIR/mongosh.tgz"',
    '      [ -x "$HOME/.local/bin/mongosh" ] && log "✅ Installed to ~/.local/bin/mongosh" || log "❌ Install failed"',
    '    else',
    '      log "❌ Download failed"',
    '    fi',
    '  fi',
    'fi',
    '',
    '# ── 3. pymongo (python3 fallback for collection listing) ──────',
    'echo ""',
    'log "--- Checking pymongo ---"',
    'if command -v python3 > /dev/null 2>&1; then',
    '  if python3 -c "import pymongo" > /dev/null 2>&1; then',
    '    log "✅ pymongo already installed"',
    '    python3 -c "import pymongo; print(\'   version: \' + pymongo.version)" 2>/dev/null | while read l; do log "$l"; done',
    '  else',
    '    log "❌ Not found. Installing via pip3..."',
    '    # Install pip3 if missing (Amazon Linux / RHEL / CentOS)',
    '    if ! command -v pip3 > /dev/null 2>&1 && ! python3 -m pip --version > /dev/null 2>&1; then',
    '      log "   pip3 not found — installing python3-pip..."',
    '      if command -v dnf > /dev/null 2>&1; then',
    '        sudo dnf install -y python3-pip 2>&1 | tail -2 | while read l; do log "   $l"; done || true',
    '      elif command -v yum > /dev/null 2>&1; then',
    '        sudo yum install -y python3-pip 2>&1 | tail -2 | while read l; do log "   $l"; done || true',
    '      elif command -v apt-get > /dev/null 2>&1; then',
    '        sudo apt-get install -y python3-pip 2>&1 | tail -2 | while read l; do log "   $l"; done || true',
    '      fi',
    '    fi',
    '    # Install pymongo',
    '    python3 -m pip install --user pymongo 2>&1 | tail -3 | while read l; do log "   $l"; done || \\',
    '      pip3 install --user pymongo 2>&1 | tail -3 | while read l; do log "   $l"; done || true',
    '    if python3 -c "import pymongo" > /dev/null 2>&1; then',
    '      log "✅ pymongo installed successfully"',
    '    else',
    '      log "⚠️  pymongo install failed (collection listing may be limited)"',
    '    fi',
    '  fi',
    'else',
    '  log "⚠️  python3 not found, skipping pymongo"',
    'fi',
    '',
    '# ── 4. Final status ───────────────────────────────────────────',
    'echo ""',
    'log "--- Final Status ---"',
    'for _t in mongoexport mongosh mongo python3 gzip curl; do',
    '  if command -v "$_t" > /dev/null 2>&1; then',
    '    log "✅ $_t: $(command -v $_t)"',
    '  elif [ -x "$HOME/.local/bin/$_t" ]; then',
    '    log "✅ $_t: $HOME/.local/bin/$_t"',
    '  else',
    '    log "⚠️  $_t: not found"',
    '  fi',
    'done',
    'if command -v python3 > /dev/null 2>&1 && python3 -c "import pymongo" > /dev/null 2>&1; then',
    '  log "✅ pymongo: installed"',
    'else',
    '  log "⚠️  pymongo: not installed"',
    'fi',
    'echo ""',
    'log "=== INSTALL_COMPLETE ==="',
  ];
  return s.join('\n');
}

function sshExecStream(sshConfig, command, onLine, onDone) {
  const conn = new Client();
  const TIMEOUT_MS = 120000;

  const timer = setTimeout(() => {
    onLine('❌ Timeout: SSH connection took too long. Check host/port/firewall.');
    onDone(1);
    try { conn.end(); } catch {}
  }, TIMEOUT_MS);

  conn.on('ready', () => {
    clearTimeout(timer);
    onLine('🔗 SSH connected. Running install script...');
    onLine('');
    conn.exec(command, (err, stream) => {
      if (err) {
        onLine('❌ SSH exec error: ' + err.message);
        onDone(1);
        conn.end();
        return;
      }
      const onData = (d) => {
        d.toString().split('\n').forEach(l => { if (l) onLine(l); });
      };
      stream.on('data', onData);
      stream.stderr.on('data', onData);
      stream.on('close', (code) => {
        onDone(code != null ? code : 0);
        conn.end();
      });
    });
  });

  conn.on('error', (err) => {
    clearTimeout(timer);
    onLine('❌ SSH error: ' + err.message);
    onDone(1);
  });

  conn.connect(sshConfig);
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { targetSshConnId } = await req.json();
  if (!targetSshConnId) return new Response('targetSshConnId required', { status: 400 });

  let sshConfig;
  try {
    sshConfig = await getSshConfig(targetSshConnId);
  } catch (err) {
    const errMsg = JSON.stringify({ line: '❌ Could not load SSH config: ' + err.message });
    const doneMsg = JSON.stringify({ done: true, code: 1 });
    return new Response('data: ' + errMsg + '\n\ndata: ' + doneMsg + '\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  }

  const script = buildInstallScript();
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(controller) {
      const send = (line) => {
        try {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ line }) + '\n\n'));
        } catch {}
      };

      sshExecStream(
        sshConfig,
        script,
        (line) => send(line),
        (code) => {
          try {
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ done: true, code }) + '\n\n'));
            controller.close();
          } catch {}
        }
      );
    }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
