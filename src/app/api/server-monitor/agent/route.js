import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand, sftpUpload } from '@/app/api/server-backup/_ssh';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { connectionId, action, method = 'tmux', serverUrl } = body;

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const origin = serverUrl || process.env.NEXTAUTH_URL || 'http://localhost:3000';

    // 1. Status Check
    if (action === 'status') {
      const statusScript = `
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
        
        # Check Node.js
        NODE_VER="$(node -v 2>/dev/null || echo 'NONE')"
        
        # Check tmux session
        TMUX_ACTIVE=0
        if command -v tmux >/dev/null 2>&1; then
          if tmux has-session -t monitor-agent 2>/dev/null || tmux has-session -t monitor-relay 2>/dev/null; then
            TMUX_ACTIVE=1
          fi
        fi

        # Check process — only match the specific monitor-agent.js script file
        # Use bracket trick to avoid matching this subshell
        PROC_ACTIVE=0
        if pgrep -f '[m]onitor-agent.js' >/dev/null 2>&1 || \
           pgrep -f '[.]monitor-agent' >/dev/null 2>&1 || \
           pgrep -f '[l]ocal-relay' >/dev/null 2>&1; then
          PROC_ACTIVE=1
        fi

        # Check systemd user service (exact match so 'inactive' is not matched)
        SERVICE_ACTIVE=0
        if systemctl --user is-active server-monitor-agent.service 2>/dev/null | grep -qx 'active'; then
          SERVICE_ACTIVE=1
        fi

        echo "NODE=$NODE_VER"
        echo "TMUX=$TMUX_ACTIVE"
        echo "PROC=$PROC_ACTIVE"
        echo "SERVICE=$SERVICE_ACTIVE"
      `;

      const result = await execCommand(sshConfig, statusScript);
      const out = result.stdout || '';

      const nodeVer = out.match(/^NODE=(.*)$/m)?.[1]?.trim() || 'NONE';
      const tmuxActive = out.match(/^TMUX=(.*)$/m)?.[1]?.trim() === '1';
      const procActive = out.match(/^PROC=(.*)$/m)?.[1]?.trim() === '1';
      const serviceActive = out.match(/^SERVICE=(.*)$/m)?.[1]?.trim() === '1';

      return NextResponse.json({
        success: true,
        nodeInstalled: nodeVer !== 'NONE',
        nodeVersion: nodeVer,
        isRunning: procActive || tmuxActive || serviceActive,
        inTmux: tmuxActive,
        inService: serviceActive,
      });
    }

    // 2. Install Node.js
    if (action === 'install_node') {
      const nodeInstallScript = `
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

        if command -v node >/dev/null 2>&1; then
          echo "✅ Node.js is already installed: $(node -v)"
          exit 0
        fi

        echo "📦 Installing Node.js 20 LTS on target server..."

        # ── Detect distro ──────────────────────────────────────────────────────
        _install_node_binary() {
          # Universal fallback: download official portable binary from nodejs.org
          echo "📦 Downloading standalone Node.js 20 portable binary..."
          ARCH=$(uname -m)
          case "$ARCH" in
            x86_64)         NARCH="x64" ;;
            aarch64|arm64)  NARCH="arm64" ;;
            armv7l)         NARCH="armv7l" ;;
            *)              NARCH="x64" ;;
          esac
          TMPDIR=$(mktemp -d 2>/dev/null || echo /tmp/node-install-$$)
          mkdir -p "$TMPDIR"
          # Install xz-utils if missing (needed for tar -xJ)
          if ! command -v xz >/dev/null 2>&1; then
            command -v apt-get >/dev/null 2>&1 && (sudo apt-get install -y -qq xz-utils 2>/dev/null || apt-get install -y -qq xz-utils 2>/dev/null) || true
            command -v apk      >/dev/null 2>&1 && apk add --no-cache xz 2>/dev/null || true
            command -v yum      >/dev/null 2>&1 && (sudo yum install -y -q xz 2>/dev/null || true)
            command -v dnf      >/dev/null 2>&1 && (sudo dnf install -y -q xz 2>/dev/null || true)
          fi
          curl -fsSL "https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-$NARCH.tar.xz" | tar -xJ -C "$TMPDIR" --strip-components=1 2>/dev/null
          sudo cp -r "$TMPDIR/bin/"* /usr/local/bin/ 2>/dev/null || cp -r "$TMPDIR/bin/"* /usr/local/bin/ 2>/dev/null || true
          sudo cp -r "$TMPDIR/lib/"* /usr/local/lib/ 2>/dev/null || cp -r "$TMPDIR/lib/"* /usr/local/lib/ 2>/dev/null || true
          rm -rf "$TMPDIR"
        }

        if [ -f /etc/os-release ]; then
          . /etc/os-release
          OS_ID="\${ID:-unknown}"
          OS_ID_LIKE="\${ID_LIKE:-}"
          VERSION_ID="\${VERSION_ID:-0}"
        else
          OS_ID="unknown"
        fi

        # ── Debian / Ubuntu ────────────────────────────────────────────────────
        if command -v apt-get >/dev/null 2>&1; then
          echo "Detected Debian/Ubuntu-based system..."
          curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || \
          curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null || true
          sudo apt-get install -y nodejs 2>/dev/null || apt-get install -y nodejs 2>/dev/null || true

        # ── Amazon Linux 2023 (uses dnf, no modules) ───────────────────────────
        elif echo "$OS_ID $OS_ID_LIKE" | grep -qi "amzn" && command -v dnf >/dev/null 2>&1; then
          echo "Detected Amazon Linux 2023..."
          sudo dnf install -y nodejs npm 2>/dev/null || dnf install -y nodejs npm 2>/dev/null || _install_node_binary

        # ── Amazon Linux 2 (uses yum + amazon-linux-extras) ───────────────────
        elif echo "$OS_ID $OS_ID_LIKE" | grep -qi "amzn" && command -v amazon-linux-extras >/dev/null 2>&1; then
          echo "Detected Amazon Linux 2..."
          sudo amazon-linux-extras install -y epel 2>/dev/null || true
          sudo amazon-linux-extras install -y nodejs18 2>/dev/null || \
          sudo amazon-linux-extras install -y nodejs 2>/dev/null || \
          _install_node_binary

        # ── RHEL / Fedora / CentOS Stream (dnf) ───────────────────────────────
        elif command -v dnf >/dev/null 2>&1; then
          echo "Detected RHEL/Fedora/CentOS Stream (dnf)..."
          # Try NodeSource RPM first, fall back to module, then binary
          (curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null || \
           curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null) || true
          sudo dnf install -y nodejs 2>/dev/null || \
          sudo dnf module install -y nodejs:20 2>/dev/null || \
          dnf install -y nodejs 2>/dev/null || \
          _install_node_binary

        # ── CentOS 7 / RHEL 7 (yum) ──────────────────────────────────────────
        elif command -v yum >/dev/null 2>&1; then
          echo "Detected CentOS/RHEL (yum)..."
          (curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null || \
           curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null) || true
          sudo yum install -y nodejs 2>/dev/null || yum install -y nodejs 2>/dev/null || _install_node_binary

        # ── Alpine Linux ───────────────────────────────────────────────────────
        elif command -v apk >/dev/null 2>&1; then
          echo "Detected Alpine Linux..."
          apk add --no-cache nodejs npm

        # ── openSUSE / SLES ────────────────────────────────────────────────────
        elif command -v zypper >/dev/null 2>&1; then
          echo "Detected openSUSE/SLES..."
          sudo zypper install -y nodejs20 2>/dev/null || sudo zypper install -y nodejs 2>/dev/null || _install_node_binary

        # ── Arch / Manjaro ─────────────────────────────────────────────────────
        elif command -v pacman >/dev/null 2>&1; then
          echo "Detected Arch-based system..."
          sudo pacman -Sy --noconfirm nodejs npm 2>/dev/null || _install_node_binary

        # ── Generic fallback ───────────────────────────────────────────────────
        else
          echo "⚠️ Unknown distro — using portable Node.js binary..."
          _install_node_binary
        fi

        # Final check
        if command -v node >/dev/null 2>&1; then
          echo "🎉 Node.js successfully installed: $(node -v)"
        else
          echo "❌ Could not install Node.js automatically. Trying portable binary fallback..."
          _install_node_binary
          if command -v node >/dev/null 2>&1; then
            echo "🎉 Node.js portable binary installed: $(node -v)"
          else
            echo "❌ All installation methods failed."
            exit 1
          fi
        fi
      `;

      const result = await execCommand(sshConfig, nodeInstallScript);
      const combinedOutput = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
      return NextResponse.json({
        success: result.code === 0,
        output: combinedOutput || (result.code === 0 ? 'Node.js installed' : 'Installation failed with code ' + result.code),
        error: result.code !== 0 ? (result.stderr || result.stdout || 'Installation failed') : null,
      });
    }

    // 3. Uninstall Agent
    if (action === 'uninstall') {
      const uninstallScript = `
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
        
        echo "Stopping systemd user service FIRST (prevents auto-restart)..."
        systemctl --user stop server-monitor-agent.service 2>/dev/null || true
        systemctl --user disable server-monitor-agent.service 2>/dev/null || true
        systemctl --user stop ssh-monitor-relay.service 2>/dev/null || true
        systemctl --user disable ssh-monitor-relay.service 2>/dev/null || true
        rm -f ~/.config/systemd/user/server-monitor-agent.service 2>/dev/null || true
        rm -f ~/.config/systemd/user/ssh-monitor-relay.service 2>/dev/null || true
        systemctl --user daemon-reload 2>/dev/null || true
        systemctl --user reset-failed 2>/dev/null || true

        echo "Stopping tmux sessions..."
        if command -v tmux >/dev/null 2>&1; then
          tmux kill-session -t monitor-agent 2>/dev/null || true
          tmux kill-session -t monitor-relay 2>/dev/null || true
        fi

        echo "Killing any remaining monitor-agent processes..."
        pkill -f '[m]onitor-agent.js' 2>/dev/null || true
        pkill -f '[.]monitor-agent' 2>/dev/null || true
        pkill -f '[l]ocal-relay' 2>/dev/null || true
        sleep 2
        # Force kill if still alive
        pkill -9 -f '[m]onitor-agent.js' 2>/dev/null || true
        pkill -9 -f '[.]monitor-agent' 2>/dev/null || true
        pkill -9 -f '[l]ocal-relay' 2>/dev/null || true
        sleep 1

        # Wait until all processes are gone (max 5 seconds)
        for i in 1 2 3 4 5; do
          if ! pgrep -f '[m]onitor-agent.js' >/dev/null 2>&1 && \
             ! pgrep -f '[.]monitor-agent' >/dev/null 2>&1 && \
             ! pgrep -f '[l]ocal-relay' >/dev/null 2>&1; then
            break
          fi
          sleep 1
        done

        rm -f ~/.monitor-agent.js ~/.monitor-agent.log ~/.monitor-agent-launcher.sh 2>/dev/null || true

        echo "✅ Agent successfully uninstalled and stopped."
      `;

      const result = await execCommand(sshConfig, uninstallScript);
      const combinedOutput = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
      return NextResponse.json({
        success: true,
        output: combinedOutput || 'Uninstalled successfully',
      });
    }

    // 4. Install Agent
    if (action === 'install') {
      // Use provided token or generate a fresh session token
      const token = body.token || crypto.randomBytes(32).toString('hex');
      if (global.__relayTokens) {
        global.__relayTokens.set(token, {
          userId: session.user?.id || 'admin',
          createdAt: Date.now(),
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        if (typeof global.__persistRelayTokens === 'function') {
          global.__persistRelayTokens().catch(() => {});
        }
      }

      // Try uploading monitor-agent.js directly via SFTP
      const agentFilePath = path.join(process.cwd(), 'public', 'monitor-agent.js');
      try {
        if (fs.existsSync(agentFilePath)) {
          await sftpUpload(sshConfig, agentFilePath, '.monitor-agent.js');
        }
      } catch (err) {
        console.warn('SFTP direct upload fallback to curl:', err.message);
      }

      let installScript = '';

      if (method === 'tmux') {
        installScript = `
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

          # 1. Check Node.js
          if ! command -v node >/dev/null 2>&1; then
            echo "❌ Node.js is not installed on this server."
            echo "Please click 'Install Node.js 20' in the wizard first."
            exit 1
          fi

          # 2. Check or install tmux (cross-distro)
          if ! command -v tmux >/dev/null 2>&1; then
            echo "📦 tmux not found, attempting to install tmux..."
            if command -v apt-get >/dev/null 2>&1; then
              sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y -qq tmux 2>/dev/null || apt-get install -y -qq tmux 2>/dev/null || true
            elif command -v dnf >/dev/null 2>&1; then
              sudo dnf install -y -q tmux 2>/dev/null || dnf install -y -q tmux 2>/dev/null || true
            elif command -v yum >/dev/null 2>&1; then
              sudo yum install -y -q tmux 2>/dev/null || yum install -y -q tmux 2>/dev/null || true
            elif command -v apk >/dev/null 2>&1; then
              apk add --no-cache tmux 2>/dev/null || true
            elif command -v zypper >/dev/null 2>&1; then
              sudo zypper install -y tmux 2>/dev/null || true
            elif command -v pacman >/dev/null 2>&1; then
              sudo pacman -Sy --noconfirm tmux 2>/dev/null || true
            fi
          fi

          # 3. Always download latest zero-dependency obfuscated monitor-agent
          echo "⬇️ Downloading Monitor Agent script..."
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.min.js" -o ~/.monitor-agent.js 2>/dev/null || \
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.js" -o ~/.monitor-agent.js 2>/dev/null || true

          if [ ! -s ~/.monitor-agent.js ]; then
            echo "❌ Failed to download monitor agent script from ${origin}"
            exit 1
          fi

          # 4. Detect Node.js binary location (bounded find to avoid deep traversal)
          NODE_BIN="$(command -v node 2>/dev/null || which node 2>/dev/null || \
            find /usr/local/bin /usr/bin -maxdepth 1 -name node 2>/dev/null | head -1 || \
            find /opt -maxdepth 4 -name node 2>/dev/null | head -1 || \
            find "$HOME/.nvm/versions" -maxdepth 3 -name node 2>/dev/null | sort -V | tail -1 || \
            echo 'node')"

          # 5. Write launcher — uses env vars for server/token to avoid quoting issues
          echo "📝 Creating launcher script..."
          cat > ~/.monitor-agent-launcher.sh << 'LAUNCHER_EOF'
#!/bin/bash
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
cd "$HOME"
NODE_BIN="$(command -v node 2>/dev/null || find /usr/local/bin /usr/bin -maxdepth 1 -name node 2>/dev/null | head -1 || find /opt -maxdepth 4 -name node 2>/dev/null | head -1 || echo 'node')"
echo "[$(date)] Starting monitor agent with $NODE_BIN..." >> "$HOME/.monitor-agent.log"
exec "$NODE_BIN" "$HOME/.monitor-agent.js" --server "$AGENT_SERVER" --token "$AGENT_TOKEN" ${connectionId ? `--connection-id "$AGENT_CONN_ID"` : ''} >> "$HOME/.monitor-agent.log" 2>&1
LAUNCHER_EOF
          chmod +x ~/.monitor-agent-launcher.sh

          # 6. Stop any existing session
          tmux kill-session -t monitor-agent 2>/dev/null || true
          pkill -9 -f '[.]monitor-agent' 2>/dev/null || true
          pkill -9 -f '[m]onitor-agent.js' 2>/dev/null || true
          sleep 1

          # 7. Launch in tmux — pass credentials as env vars (no quoting issues)
          echo "🚀 Launching Monitor Agent in detached tmux session [monitor-agent]..."
          AGENT_SERVER="${origin}" AGENT_TOKEN="${token}" AGENT_CONN_ID="${connectionId || ''}" \
            tmux new-session -d -s monitor-agent \
              "AGENT_SERVER='${origin}' AGENT_TOKEN='${token}' AGENT_CONN_ID='${connectionId || ''}' bash $HOME/.monitor-agent-launcher.sh"
          sleep 2

          # 8. Verify and clean up
          if tmux has-session -t monitor-agent 2>/dev/null; then
            echo "✅ Monitor Agent is running in background tmux session!"
            echo "📋 View live logs: tmux attach -t monitor-agent  (detach: Ctrl+B then D)"
            rm -f ~/.monitor-agent-launcher.sh ~/.monitor-agent.js 2>/dev/null || true
            # Give process 2s to start, then verify
            sleep 2
            if pgrep -f '[.]monitor-agent' >/dev/null 2>&1 || \
               pgrep -f '[m]onitor-agent.js' >/dev/null 2>&1 || \
               ps aux 2>/dev/null | grep -v grep | grep -q 'monitor-agent' 2>/dev/null; then
              echo "✅ Process confirmed running"
            else
              echo "⚠️ Process still initializing — check: tail -f ~/.monitor-agent.log"
            fi
          else
            echo "⚠️ tmux session failed — falling back to nohup..."
            AGENT_SERVER="${origin}" AGENT_TOKEN="${token}" AGENT_CONN_ID="${connectionId || ''}" \
              nohup bash "$HOME/.monitor-agent-launcher.sh" >/dev/null 2>&1 &
            sleep 3
            rm -f ~/.monitor-agent-launcher.sh ~/.monitor-agent.js 2>/dev/null || true
            if pgrep -f '[.]monitor-agent' >/dev/null 2>&1 || \
               pgrep -f '[m]onitor-agent.js' >/dev/null 2>&1 || \
               ps aux 2>/dev/null | grep -v grep | grep -q 'monitor-agent' 2>/dev/null; then
              echo "✅ Monitor Agent running via nohup"
              echo "📋 View logs: tail -f ~/.monitor-agent.log"
            else
              echo "❌ Agent failed to start. Check: tail ~/.monitor-agent.log"
              exit 1
            fi
          fi
          rm -f ~/.monitor-agent-launcher.sh ~/.monitor-agent.js 2>/dev/null || true
        `;
      } else {
        // systemd service install
        installScript = `
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

          if ! command -v node >/dev/null 2>&1; then
            echo "❌ Node.js is not installed on this server."
            echo "Please click 'Install Node.js 20' in the wizard first."
            exit 1
          fi

          # Download latest agent script
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.min.js" -o ~/.monitor-agent.js 2>/dev/null || \
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.js" -o ~/.monitor-agent.js 2>/dev/null || true

          if [ ! -s ~/.monitor-agent.js ]; then
            echo "❌ Failed to download monitor agent script from ${origin}"
            exit 1
          fi

          echo "🚀 Installing Monitor Agent as background system service..."
          # Pass credentials as env vars to avoid shell quoting issues with special chars
          AGENT_SERVER="${origin}" AGENT_TOKEN="${token}" AGENT_CONN_ID="${connectionId || ''}" \
            node ~/.monitor-agent.js --install \
              --server "${origin}" \
              --token "${token}" \
              ${connectionId ? `--connection-id "${connectionId}"` : ''}
        `;
      }

      const result = await execCommand(sshConfig, installScript);
      const combinedOutput = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
      const isSuccess = result.code === 0 || combinedOutput.includes('✅');

      return NextResponse.json({
        success: isSuccess,
        output: combinedOutput || (isSuccess ? 'Agent launched successfully' : 'Installation failed with code ' + result.code),
        error: !isSuccess ? (result.stderr || result.stdout || 'Installation failed with exit code ' + result.code) : null,
        token,
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[server-monitor/agent] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
