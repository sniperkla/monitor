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
        if command -v apt-get >/dev/null 2>&1; then
          echo "Detected Debian/Ubuntu..."
          (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -) || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash -)
          sudo apt-get install -y nodejs || apt-get install -y nodejs
        elif command -v dnf >/dev/null 2>&1; then
          echo "Detected RHEL/Fedora/CentOS Stream..."
          sudo dnf module install -y nodejs:20 || sudo dnf install -y nodejs || dnf install -y nodejs
        elif command -v yum >/dev/null 2>&1; then
          echo "Detected CentOS/RHEL..."
          (curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -) || (curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -)
          sudo yum install -y nodejs || yum install -y nodejs
        elif command -v apk >/dev/null 2>&1; then
          echo "Detected Alpine Linux..."
          apk add --no-cache nodejs npm
        else
          # Fallback: install standalone portable official binary from nodejs.org
          echo "📦 Downloading standalone Node.js portable binary..."
          ARCH=$(uname -m)
          case "$ARCH" in
            x86_64) NARCH="x64" ;;
            aarch64|arm64) NARCH="arm64" ;;
            armv7l) NARCH="armv7l" ;;
            *) NARCH="x64" ;;
          esac
          mkdir -p /tmp/node-install
          curl -fsSL "https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-\${NARCH}.tar.xz" | tar -xJ -C /tmp/node-install --strip-components=1 2>/dev/null
          sudo cp -r /tmp/node-install/bin/* /usr/local/bin/ 2>/dev/null || cp -r /tmp/node-install/bin/* /usr/local/bin/ 2>/dev/null
          sudo cp -r /tmp/node-install/lib/* /usr/local/lib/ 2>/dev/null || cp -r /tmp/node-install/lib/* /usr/local/lib/ 2>/dev/null
          rm -rf /tmp/node-install
        fi

        if command -v node >/dev/null 2>&1; then
          echo "🎉 Node.js successfully installed: $(node -v)"
        else
          echo "❌ Could not complete Node.js installation automatically."
          exit 1
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

          # 2. Check or install tmux
          if ! command -v tmux >/dev/null 2>&1; then
            echo "📦 tmux not found, attempting to install tmux..."
            if command -v apt-get >/dev/null 2>&1; then
              sudo apt-get update -qq && sudo apt-get install -y -qq tmux || apt-get install -y -qq tmux
            elif command -v dnf >/dev/null 2>&1; then
              sudo dnf install -y -q tmux || dnf install -y -q tmux
            elif command -v yum >/dev/null 2>&1; then
              sudo yum install -y -q tmux || yum install -y -q tmux
            elif command -v apk >/dev/null 2>&1; then
              apk add --no-cache tmux
            fi
          fi

          # 3. Always download latest zero-dependency monitor-agent.js
          echo "⬇️ Downloading latest Monitor Agent script..."
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.js" -o ~/.monitor-agent.js 2>/dev/null || \\
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.min.js" -o ~/.monitor-agent.js 2>/dev/null || true

          if [ ! -s ~/.monitor-agent.js ]; then
            echo "❌ Failed to download ~/.monitor-agent.js from ${origin}"
            exit 1
          fi

          # 4. Create a simple launcher script
          echo "📝 Creating launcher script..."
          cat > ~/.monitor-agent-launcher.sh << 'LAUNCHER_EOF'
#!/bin/bash
cd ~
exec node ~/.monitor-agent.js --server '${origin}' --token '${token}'${connectionId ? ` --connection-id '${connectionId}'` : ''} >> ~/.monitor-agent.log 2>&1
LAUNCHER_EOF
          chmod +x ~/.monitor-agent-launcher.sh

          # 5. Stop existing session
          tmux kill-session -t monitor-agent 2>/dev/null || true
          pkill -f '[m]onitor-agent' 2>/dev/null || true
          sleep 1

          # 6. Launch in tmux using the launcher script - this WILL detach properly
          echo "🚀 Launching Monitor Agent in detached tmux session [monitor-agent]..."
          tmux new-session -d -s monitor-agent ~/.monitor-agent-launcher.sh
          
          # Give it a moment to initialize
          sleep 2

          # 7. Verify the session was created
          if tmux has-session -t monitor-agent 2>/dev/null; then
            echo "✅ Monitor Agent is running in background tmux session!"
            echo "📋 To view agent live logs: tmux attach -t monitor-agent"
            echo "📋 To detach from logs: Press Ctrl+B then D"
            # Double-check process is actually running
            if pgrep -f '[m]onitor-agent' >/dev/null 2>&1; then
              echo "✅ Process confirmed running (PID: \$(pgrep -f '[m]onitor-agent' | head -1))"
            else
              echo "⚠️ tmux session created but process not detected yet - initializing..."
              sleep 2
              if pgrep -f '[m]onitor-agent' >/dev/null 2>&1; then
                echo "✅ Process now running (PID: \$(pgrep -f '[m]onitor-agent' | head -1))"
              else
                echo "⚠️ Process may still be starting. Check with: tmux attach -t monitor-agent"
              fi
            fi
          else
            echo "⚠️ tmux session creation failed. Attempting nohup fallback..."
            nohup node ~/.monitor-agent.js --server '${origin}' --token '${token}'${connectionId ? ` --connection-id '${connectionId}'` : ''} > ~/.monitor-agent.log 2>&1 </dev/null &
            sleep 2
            if pgrep -f '[m]onitor-agent' >/dev/null 2>&1; then
              echo "✅ Monitor Agent running in background via nohup (PID: \$(pgrep -f '[m]onitor-agent' | head -1))"
              echo "📋 To view logs: tail -f ~/.monitor-agent.log"
            else
              echo "❌ Failed to start agent process. Check logs: tail ~/.monitor-agent.log"
              exit 1
            fi
          fi
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

          # Always download latest zero-dependency script
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.js" -o ~/.monitor-agent.js 2>/dev/null || \\
          curl -fsSL -H "Cache-Control: no-cache" "${origin}/monitor-agent.min.js" -o ~/.monitor-agent.js 2>/dev/null || true

          echo "🚀 Installing Monitor Agent as background system service..."
          node ~/.monitor-agent.js --install --server '${origin}' --token '${token}'${connectionId ? ` --connection-id '${connectionId}'` : ''}
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
