#!/usr/bin/env bash
# diagnose-agents.sh — read-only triage for "AI Agents screen shows nothing"
#
# Run this ON the Fedora box, as the SAME user the monitor dashboard SSHs in as
# (see Connections → that server → username). From your Mac:
#
#   ssh <that-user>@<your-fedora-box> 'bash -s' < scripts/diagnose-agents.sh
#
# It replays the exact probe commands the dashboard sends, so the output says
# which half of the detection is failing. It changes nothing.

say() { printf '\n=== %s ===\n' "$1"; }

say "0. Who am I (this MUST match the dashboard's SSH username)"
echo "user     : $(whoami)"
echo "HOME     : $HOME"
echo "hostname : $(hostname)"
echo
echo "The probes below all resolve \$HOME. If you installed the agents as a"
echo "different user than the one above, \$HOME points at the wrong place and"
echo "every check comes back empty. That is the #1 cause of 'shows nothing'."

# ── The exact PATH the dashboard's probes use ────────────────────────────────
PROBE_PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

say "1. nanobot probe (verbatim copy of STATUS_SCRIPT)"
env -i HOME="$HOME" PATH="$PROBE_PATH" sh -c '
BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET   <- dashboard shows INSTALLED"; echo "path: $BIN"; else echo "BIN=UNSET <- dashboard shows NOT INSTALLED"; fi
CFG=0; [ -f "$HOME/.nanobot/config.json" ] && CFG=1
echo "CONFIG=$CFG"
PROC=0; pgrep -f "[n]anobot.*gatew[a]y" >/dev/null 2>&1 && PROC=1
echo "PROC=$PROC"
'

say "2. hermes probe (verbatim copy of the status check)"
env -i HOME="$HOME" PATH="$PROBE_PATH" sh -c '
HH="$HOME/.hermes"
if [ -d "$HH" ]; then echo "HOME_DIR=EXISTS   ($HH)"; else echo "HOME_DIR=ABSENT   <- $HH missing, detection fails"; fi
p="$(command -v hermes 2>/dev/null)"
if [ -n "$p" ]; then echo "BIN=$p"; else echo "BIN=<empty>       <- hermes not on the probe PATH"; fi
echo
echo "Rule: installed = (BIN non-empty AND HOME_DIR exists) OR process running."
echo "A binary alone is NOT enough — ~/.hermes must exist too."
'

say "3. Where the binaries ACTUALLY are (your interactive shell)"
for b in hermes nanobot; do
  p=$(command -v "$b" 2>/dev/null)
  if [ -n "$p" ]; then
    echo "FOUND   $b -> $p"
    echo "        real: $(readlink -f "$p" 2>/dev/null || echo "$p")"
  else
    echo "MISSING $b"
  fi
done
echo
echo "If a binary is FOUND here but the probe above said UNSET, it lives in a"
echo "directory outside the probe PATH (a venv, conda, /opt, a custom prefix)."

say "4. Agent home directories"
for d in .hermes .nanobot .openclaw .zeroclaw; do
  if [ -d "$HOME/$d" ]; then
    echo "EXISTS  ~/$d"
  else
    echo "ABSENT  ~/$d"
  fi
done

say "5. Candidate install locations the probe would MISS"
for d in "$HOME/.local/share/pipx/venvs" "$HOME/.venvs" "$HOME/venv" "$HOME/.cache/pypoetry/virtualenvs" /opt /srv; do
  [ -d "$d" ] && echo "--- $d ---" && ls "$d" 2>/dev/null | head -12
done
[ -d "$HOME/.cargo/bin" ] && echo "--- ~/.cargo/bin ---" && ls "$HOME/.cargo/bin" | head -12
echo
echo "Anything named hermes/nanobot under these is invisible to the probe."

say "6. Runtime state"
echo -n "hermes process : "; pgrep -af '[h]ermes' 2>/dev/null | head -3 || echo "none"
echo -n "nanobot gateway: "; pgrep -af '[n]anobot.*gatew[a]y' 2>/dev/null | head -3 || echo "none"

say "7. systemd user manager (Fedora-specific)"
echo "XDG_RUNTIME_DIR = ${XDG_RUNTIME_DIR:-<unset>}"
echo -n "systemd --user reachable: "
if systemctl --user show-environment >/dev/null 2>&1; then echo "YES"; else echo "NO"; fi
echo -n "loginctl linger         : "
if loginctl show-user "$(whoami)" 2>/dev/null | grep -q 'Linger=yes'; then
  echo "YES"
else
  echo "NO"
  echo "  Without linger the user manager dies at logout, so"
  echo "  'systemctl --user is-active <agent>' returns non-zero and the UI says"
  echo "  'stopped' even when the agent runs. Fix:"
  echo "    sudo loginctl enable-linger $(whoami)"
fi

say "8. SELinux (Fedora enforces it; Ubuntu does not)"
if command -v getenforce >/dev/null 2>&1; then
  echo "mode: $(getenforce 2>/dev/null)"
  echo "The dashboard writes units to ~/.config/systemd/user/ with"
  echo "EnvironmentFile=%h/... and StandardOutput=append:%h/... — both are"
  echo "classic denial points under enforcing SELinux."
else
  echo "SELinux tools not present"
fi

say "9. Python (the nanobot installer asks for python3.11)"
echo "python3    : $(command -v python3 2>/dev/null || echo MISSING) $(python3 -V 2>&1)"
echo -n "python3.11 : "
if command -v python3.11 >/dev/null 2>&1; then echo present; else
  echo "ABSENT  (Fedora 40 ships 3.12; the installer prints PYTHON_PREREQ_SKIPPED and carries on)"
fi

say "10. Tools the probes assume exist"
for t in pgrep curl tar xz git systemctl python3 docker sudo; do
  command -v "$t" >/dev/null 2>&1 && echo "OK      $t" || echo "MISSING $t"
done

say "11. Distro"
grep -E '^(NAME|VERSION)=' /etc/os-release 2>/dev/null

say "DONE — paste this whole output back"
