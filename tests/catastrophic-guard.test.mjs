const _SYSTEM_ROOTS = new Set(['/', '/etc', '/usr', '/var', '/boot', '/home', '/root', '/opt', '/bin', '/sbin', '/lib', '/lib64', '/dev', '/proc', '/sys', '/run', '/srv']);
const _normPathToken = (tok) => {
  let t = String(tok || '').replace(/^['"(]+|['")]+$/g, '').replace(/\*+$/, '');
  if (/^\/+$/.test(t)) return '/';
  return t.replace(/\/+$/, '').toLowerCase();
};
const _isSystemRootToken = (tok) => { const t = _normPathToken(tok); return _SYSTEM_ROOTS.has(t) || t === '~' || t === '$home' || t === '$homedir'; };
const isCatastrophicCommand = (rawCmd) => {
  const cmd = String(rawCmd || '');
  if (!cmd.trim()) return false;
  if (/--no-preserve-root/i.test(cmd)) return true;
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;\s*:/.test(cmd)) return true;
  if (/\bmkfs/i.test(cmd)) return true;
  if (/\bdd\b[^|;&]*\bof=\s*"?\s*\/dev\/(sd|hd|vd|nvme|xvd|mmcblk)/i.test(cmd)) return true;
  if (/>\s*\/dev\/(sd|hd|vd|nvme|xvd|mmcblk)/i.test(cmd)) return true;
  if (/(^|[;&|(]\s*)(sudo\s+)?(shutdown|poweroff|halt|reboot)\b/i.test(cmd)) return true;
  if (/\binit\s+[06]\b\s*$/.test(cmd.trim())) return true;
  if (/\bkill\s+(?:-\w+\s+)*-1\b/.test(cmd)) return true;
  const tokens = cmd.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const base = tokens[i].split('/').pop();
    if (base !== 'rm' && base !== 'chmod' && base !== 'chown') continue;
    let j = i + 1, flags = '';
    while (j < tokens.length && /^-{1,2}[A-Za-z-]/.test(tokens[j]) && tokens[j] !== '--') { flags += tokens[j]; j++; }
    const isRecursive = /r/i.test(flags.replace(/-/g, '')) || /--recursive/.test(flags);
    if (!isRecursive) continue;
    for (let k = j; k < tokens.length; k++) {
      const tok = tokens[k];
      if (tok === '&&' || tok === '||' || tok === ';' || tok === '|') break;
      if (_isSystemRootToken(tok)) return true;
      if (tok === '*' || tok === './*') return true;
    }
  }
  return false;
};

const CASES = [
  // ── MUST BLOCK ──
  ['rm -rf / --no-preserve-root', true],
  ['sudo rm -rf /*', true],
  ['rm -rf /etc /usr', true],
  ["rm -rf '/var/'", true],
  ['rm -fr ~', true],
  ['rm -rf $HOME', true],
  ['rm -r /boot/*', true],
  ['rm -rf *', true],
  ['/bin/rm -rf /opt', true],
  ['cd /app && rm -rf /', true],
  ['mkfs.ext4 /dev/sda1', true],
  ['sudo mkfs -t ext4 /dev/vdb', true],
  ['dd if=/dev/zero of=/dev/sda', true],
  ['dd bs=4M if=img.iso of=/dev/nvme0n1', true],
  ['echo x > /dev/nvme0n1', true],
  ['cat img.bin > /dev/sdb', true],
  [':(){ :|:& };:', true],
  ['sudo shutdown -h now', true],
  ['reboot', true],
  ['init 0', true],
  ['sudo init 6', true],
  ['kill -9 -1', true],
  ['chmod -R 000 /etc', true],
  ['chown -R user:user /usr', true],
  // ── MUST ALLOW (normal ops) ──
  ['rm -rf ./node_modules/.cache', false],
  ['rm -rf /var/log/myapp/*.log', false],
  ['rm -rf dist build', false],
  ['rm -f /tmp/x.txt', false],
  ['rm file.txt', false],
  ['mkdir -p /var/www/app && rm -rf /var/www/app/node_modules', false],
  ['pm2 restart app', false],
  ['systemctl reload nginx', false],
  ['apt-get install -y docker.io', false],
  ['docker rm -f mycontainer', false],
  ['kill -9 12345', false],
  ['echo "remember to reboot later"', false],
  ['tail -f /var/log/syslog', false],
  ['grep -r pattern /etc/nginx/', false],
  ['ls /', false],
  ['df -h /dev/sda1', false],
  ['', false],
];

let fail = 0;
for (const [c, want] of CASES) {
  const got = isCatastrophicCommand(c);
  if (got !== want) { fail++; console.log(`FAIL got=${got} want=${want}: ${JSON.stringify(c)}`); }
}
console.log(fail === 0 ? `ALL ${CASES.length} GUARD CASES PASS` : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
