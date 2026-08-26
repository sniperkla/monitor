/**
 * compatProbeScript.js — POSIX-sh capability probe, executed over SSH.
 * Emits one line per check:  <id>|<pass|warn|fail|info>|<detail>
 * Runs under ash/busybox/dash/bash on any distro.
 */
export const COMPAT_PROBE = String.raw`
emit() { echo "$1|$2|$3"; }
have() { command -v "$1" >/dev/null 2>&1; }

D="-"; . /etc/os-release 2>/dev/null && D="$PRETTY_NAME"; [ -z "$D" ] && D="$ID"
echo "distro|info|$D"

if have node; then emit node pass "$(node -v 2>/dev/null)"; else emit node fail "not installed"; fi
if have npm; then emit npm pass "npm $(npm -v 2>/dev/null)"; else emit npm fail "not installed"; fi

for c in pgrep pkill ps nohup setsid; do
  if have "$c"; then emit "$c" pass "$(command -v "$c")"; else emit "$c" fail "missing"; fi
done

if have tmux; then emit tmux pass "$(tmux -V 2>/dev/null)"; else emit tmux warn "missing (auto-install available)"; fi
if have crontab; then emit cron pass "available"; else emit cron warn "missing (scheduled jobs limited)"; fi

SYSTEMD="absent"
if have systemctl; then
  S=$(systemctl is-system-running 2>/dev/null)
  [ "$S" = "running" ] || [ "$S" = "degraded" ] && SYSTEMD="running" || SYSTEMD="stopped"
fi
[ "$SYSTEMD" = "running" ] && emit systemd pass "active" || emit systemd warn "$SYSTEMD (service method limited)"

if [ "$(id -u)" = "0" ]; then
  emit priv pass "root user"
elif sudo -n true 2>/dev/null; then
  emit priv pass "passwordless sudo"
elif have sudo; then
  emit priv warn "sudo requires password"
else
  emit priv warn "no sudo binary"
fi

have nproc && emit nproc pass "$(nproc 2>/dev/null)" || emit nproc fail "missing"
if free -b >/dev/null 2>&1; then emit mem_free pass "ok"; else emit mem_free fail "missing"; fi
df -Pk / >/dev/null 2>&1 && emit df_pk pass "ok" || emit df_pk fail "missing"
[ -r /proc/uptime ] && emit proc_uptime pass "ok" || emit proc_uptime fail "unreadable"
[ -r /proc/net/dev ] && emit net_dev pass "ok" || emit net_dev fail "unreadable"
# The hostname binary is missing on some minimal images (e.g. Arch containers);
# uname -n reports the same nodename and is always present on Linux.
if hostname >/dev/null 2>&1; then emit hostname_cmd pass "ok"
elif uname -n >/dev/null 2>&1; then emit hostname_cmd pass "ok (uname -n fallback)"
else emit hostname_cmd fail "missing"; fi
uname -r >/dev/null 2>&1 && emit uname pass "ok" || emit uname fail "missing"

if grep -m1 "model name" /proc/cpuinfo >/dev/null 2>&1; then
  emit cpu_model pass "ok"
else
  emit cpu_model warn "no model name (fallback used)"
fi
uptime -p >/dev/null 2>&1 && emit uptime_p pass "ok" || emit uptime_p warn "unsupported (fallback used)"

if have curl && curl -fsSL --max-time 8 https://www.google.com/generate_204 -o /dev/null 2>/dev/null; then
  emit curl_tls pass "TLS verified"
elif have curl; then
  emit curl_tls warn "present but HTTPS test failed (CA certificates?)"
else
  emit curl_tls fail "not installed"
fi
have wget && emit wget pass "fallback available" || emit wget warn "no fallback downloader"
have xz && emit xz pass "tar -xJ capable" || emit xz warn "xz missing (portable path limited)"

GLIBC_MODE="non-glibc (musl)"; GLIBC_VER=""
if have ldd && ldd --version 2>&1 | grep -qiE 'glibc|gnu libc'; then
  GLIBC_VER=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' | head -1)
  GLIBC_MODE="glibc $GLIBC_VER"
  OK=$(awk -v v="$GLIBC_VER" 'BEGIN{print (v>=2.28)?1:0}' 2>/dev/null)
  [ "$OK" = "1" ] && emit libc pass "$GLIBC_MODE — portable Node 20 OK" || emit libc warn "$GLIBC_MODE <2.28 — Node 20 binaries incompatible"
else
  emit libc warn "$GLIBC_MODE — distro packages only"
fi
`;
