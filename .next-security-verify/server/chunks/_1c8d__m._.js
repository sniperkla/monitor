module.exports=[98501,e=>e.a(async(t,n)=>{try{var o=e.i(89171),l=e.i(23667),s=e.i(80533),a=e.i(47185),r=e.i(54799),i=e.i(22734),u=e.i(14747),d=e.i(51631),c=t([s,a]);async function m(t){try{let n=await (0,l.getServerSession)(s.authOptions);if(!n)return o.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let c=await t.json(),{connectionId:m,action:p,method:h="tmux",serverUrl:v}=c;if(!m)return o.NextResponse.json({success:!1,error:"Missing connectionId"},{status:400});let f=await (0,a.getSshConfig)(m),g=v||process.env.NEXTAUTH_URL||"http://localhost:3000";if("status"===p){let e=`
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
      `,t=(await (0,a.execCommand)(f,e)).stdout||"",n=t.match(/^NODE=(.*)$/m)?.[1]?.trim()||"NONE",l=t.match(/^TMUX=(.*)$/m)?.[1]?.trim()==="1",s=t.match(/^PROC=(.*)$/m)?.[1]?.trim()==="1",r=t.match(/^SERVICE=(.*)$/m)?.[1]?.trim()==="1";return o.NextResponse.json({success:!0,nodeInstalled:"NONE"!==n,nodeVersion:n,isRunning:s||l||r,inTmux:l,inService:r})}if("install_node"===p){let e=`
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

        # 🔧 PREREQUISITE BOOTSTRAP — minimal systems (bare Debian, tiny Alpine
        # images, custom AMIs) may lack curl/xz/procps. Install them quietly via
        # whichever package manager exists so every later step just works.
        for _pm in apt-get dnf yum apk zypper pacman; do
          command -v $_pm >/dev/null 2>&1 || continue
          if [ $_pm = apt-get ]; then
            $_pm update -qq >/dev/null 2>&1 || true
            $_pm install -y -qq curl ca-certificates xz-utils procps >/dev/null 2>&1 || true
          elif [ $_pm = apk ]; then
            $_pm add --no-cache curl ca-certificates xz procps >/dev/null 2>&1 || true
          else
            $_pm install -y -q curl xz procps >/dev/null 2>&1 || true
          fi
          break
        done

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
          # Verify the binary actually EXECUTES — very old distros (e.g. CentOS 7,
          # glibc 2.17) cannot run official Node 20 builds even though the file exists.
          if ! node -v >/dev/null 2>&1; then
            GLIBC_VER=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+.[0-9]+$')
            echo "❌ Portable Node binary downloaded but cannot run on this system (glibc \${GLIBC_VER:-unknown} found, 2.28+ required)." >&2
            echo "   Upgrade the OS or install a distro-native Node package instead." >&2
          fi
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
          # AL2023's own repo ships Node 18 (epoch 1) and its repo priority makes
          # dnf resolve 'nodejs' to 18 even when NodeSource 20.x is enabled.
          # Ladder: NodeSource 20 (amzn repos excluded) → distro 18 (works for agent) → portable binary 20.
          (curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null || true)
          sudo dnf install -y --disablerepo=amazonlinux --disablerepo=kernel-livepatch nodejs npm 2>/dev/null \
            || sudo dnf install -y nodejs npm 2>/dev/null \
            || _install_node_binary

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
        # Final check — Node must actually EXECUTE, not merely exist on disk
        NODE_V=$(node -v 2>/dev/null)
        if [ -n "$NODE_V" ]; then
          echo "🎉 Node.js successfully installed: $NODE_V"
        else
          echo "❌ Could not install a WORKING Node.js automatically (see messages above)."
          exit 1
        fi
      `,t=await (0,a.execCommand)(f,e),n=((t.stdout||"")+"\n"+(t.stderr||"")).trim();return o.NextResponse.json({success:0===t.code,output:n||(0===t.code?"Node.js installed":"Installation failed with code "+t.code),error:0!==t.code?t.stderr||t.stdout||"Installation failed":null})}if("uninstall"===p){let e=`
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
      `,t=await (0,a.execCommand)(f,e),n=((t.stdout||"")+"\n"+(t.stderr||"")).trim();return o.NextResponse.json({success:!0,output:n||"Uninstalled successfully"})}if("install"===p){let t=c.token||r.default.randomBytes(32).toString("hex");e.g.__relayTokens&&(e.g.__relayTokens.set(t,{userId:n.user?.id||"admin",createdAt:Date.now(),expiresAt:Date.now()+31536e6}),"function"==typeof e.g.__persistRelayTokens&&e.g.__persistRelayTokens().catch(()=>{}));let l=u.default.join(process.cwd(),"public","monitor-agent.js");try{i.default.existsSync(l)&&await (0,a.sftpUpload)(f,l,".monitor-agent.js")}catch(e){d.logger.warn("SFTP direct upload fallback to curl:",e.message)}let s="";s="tmux"===h?`
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

          # 🔧 PREREQUISITE BOOTSTRAP — same as Node installer: make sure the
          # process tools this agent relies on exist on minimal systems.
          for _pm in apt-get dnf yum apk zypper pacman; do
            command -v $_pm >/dev/null 2>&1 || continue
            if [ $_pm = apt-get ]; then
              $_pm update -qq >/dev/null 2>&1 || true
              $_pm install -y -qq procps curl ca-certificates >/dev/null 2>&1 || true
            elif [ $_pm = apk ]; then
              $_pm add --no-cache procps curl ca-certificates >/dev/null 2>&1 || true
            else
              $_pm install -y -q procps curl >/dev/null 2>&1 || true
            fi
            break
          done

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
          curl -fsSL -H "Cache-Control: no-cache" "${g}/monitor-agent.min.js" -o ~/.monitor-agent.js 2>/dev/null || \
          curl -fsSL -H "Cache-Control: no-cache" "${g}/monitor-agent.js" -o ~/.monitor-agent.js 2>/dev/null || true

          if [ ! -s ~/.monitor-agent.js ]; then
            echo "❌ Failed to download monitor agent script from ${g}"
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
exec "$NODE_BIN" "$HOME/.monitor-agent.js" --server "$AGENT_SERVER" --token "$AGENT_TOKEN" ${m?'--connection-id "$AGENT_CONN_ID"':""} >> "$HOME/.monitor-agent.log" 2>&1
LAUNCHER_EOF
          chmod +x ~/.monitor-agent-launcher.sh

          # 6. Stop any existing session
          tmux kill-session -t monitor-agent 2>/dev/null || true
          pkill -9 -f '[.]monitor-agent' 2>/dev/null || true
          pkill -9 -f '[m]onitor-agent.js' 2>/dev/null || true
          sleep 1

          # 7. Launch in tmux — pass credentials as env vars (no quoting issues)
          echo "🚀 Launching Monitor Agent in detached tmux session [monitor-agent]..."
          AGENT_SERVER="${g}" AGENT_TOKEN="${t}" AGENT_CONN_ID="${m||""}" \
            tmux new-session -d -s monitor-agent \
              "AGENT_SERVER='${g}' AGENT_TOKEN='${t}' AGENT_CONN_ID='${m||""}' bash $HOME/.monitor-agent-launcher.sh"
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
            AGENT_SERVER="${g}" AGENT_TOKEN="${t}" AGENT_CONN_ID="${m||""}" \
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
        `:`
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

          if ! command -v node >/dev/null 2>&1; then
            echo "❌ Node.js is not installed on this server."
            echo "Please click 'Install Node.js 20' in the wizard first."
            exit 1
          fi

          # Download latest agent script
          curl -fsSL -H "Cache-Control: no-cache" "${g}/monitor-agent.min.js" -o ~/.monitor-agent.js 2>/dev/null || \
          curl -fsSL -H "Cache-Control: no-cache" "${g}/monitor-agent.js" -o ~/.monitor-agent.js 2>/dev/null || true

          if [ ! -s ~/.monitor-agent.js ]; then
            echo "❌ Failed to download monitor agent script from ${g}"
            exit 1
          fi

          echo "🚀 Installing Monitor Agent as background system service..."
          # Pass credentials as env vars to avoid shell quoting issues with special chars
          AGENT_SERVER="${g}" AGENT_TOKEN="${t}" AGENT_CONN_ID="${m||""}" \
            node ~/.monitor-agent.js --install \
              --server "${g}" \
              --token "${t}" \
              ${m?`--connection-id "${m}"`:""}
        `;let p=await (0,a.execCommand)(f,s),v=((p.stdout||"")+"\n"+(p.stderr||"")).trim(),y=0===p.code||v.includes("✅");return o.NextResponse.json({success:y,output:v||(y?"Agent launched successfully":"Installation failed with code "+p.code),error:y?null:p.stderr||p.stdout||"Installation failed with exit code "+p.code,token:t})}return o.NextResponse.json({success:!1,error:"Unknown action"},{status:400})}catch(e){return d.logger.error("[server-monitor/agent] error:",e),o.NextResponse.json({success:!1,error:e.message},{status:500})}}[s,a]=c.then?(await c)():c,e.s(["POST",0,m]),n()}catch(e){n(e)}},!1),43235,e=>{"use strict";var t=e.i(8970),n=e.i(74017),o=e.i(96250),l=e.i(59756),s=e.i(61916),a=e.i(74677),r=e.i(69741),i=e.i(16795),u=e.i(87718),d=e.i(95169),c=e.i(47587),m=e.i(66012),p=e.i(70101),h=e.i(26937),v=e.i(10372),f=e.i(93695);e.i(52474);var g=e.i(5232);let y=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/server-monitor/agent/route",pathname:"/api/server-monitor/agent",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/server-monitor/agent/route.js",nextConfigOutput:"",userland:()=>e.r(98501),...{}}),{workAsyncStorage:x,workUnitAsyncStorage:E,serverHooks:b}=y;async function _(e,t,o){o.requestMeta&&(0,l.setRequestMeta)(e,o.requestMeta),y.isDev&&(0,l.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let x="/api/server-monitor/agent/route";x=x.replace(/\/index$/,"")||"/";let E=await y.prepare(e,t,{srcPage:x,multiZoneDraftMode:!1});if(!E)return t.statusCode=400,t.end("Bad Request"),null==o.waitUntil||o.waitUntil.call(o,Promise.resolve()),null;let{buildId:b,deploymentId:_,params:R,nextConfig:N,parsedUrl:C,isDraftMode:T,prerenderManifest:$,routerServerContext:A,isOnDemandRevalidate:S,revalidateOnlyGenerated:I,resolvedPathname:k,clientReferenceManifest:O,serverActionsManifest:w}=E,j=(0,r.normalizeAppPath)(x),D=!!($.dynamicRoutes[j]||$.routes[k]),P=async()=>((null==A?void 0:A.render404)?await A.render404(e,t,C,!1):t.end("This page could not be found"),null);if(D&&!T){let e=!!$.routes[k],t=$.dynamicRoutes[j];if(t&&!1===t.fallback&&!e){if(N.adapterPath)return await P();throw new f.NoFallbackError}}let H=null;!D||y.isDev||T||(H="/index"===(H=k)?"/":H);let q=!0===y.isDev||!D,M=D&&!q;w&&O&&(0,a.setManifestsSingleton)({page:x,clientReferenceManifest:O,serverActionsManifest:w});let L=e.method||"GET",U=(0,s.getTracer)(),z=U.getActiveScopeSpan(),V=!!(null==A?void 0:A.isWrappedByNextServer),G=!!(0,l.getRequestMeta)(e,"minimalMode"),F=(0,l.getRequestMeta)(e,"incrementalCache")||await y.getIncrementalCache(e,N,$,G);null==F||F.resetRequestCache(),globalThis.__incrementalCache=F;let K={params:R,previewProps:$.preview,renderOpts:{experimental:{authInterrupts:!!N.experimental.authInterrupts,useCacheTimeout:N.experimental.useCacheTimeout},cacheComponents:!!N.cacheComponents,validationLevel:N.experimental.instantInsights.validationLevel,supportsDynamicResponse:q,incrementalCache:F,hmrRefreshHash:(0,l.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:N.cacheLife,staticPageGenerationTimeout:N.staticPageGenerationTimeout,waitUntil:o.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,o,l)=>y.onRequestError(e,t,o,l,A)},sharedContext:{buildId:b,deploymentId:_}},B=new i.NodeNextRequest(e),X=new i.NodeNextResponse(t),W=u.NextRequestAdapter.fromNodeNextRequest(B,(0,u.signalFromNodeResponse)(t)),J=async({previousCacheEntry:n})=>{try{if(!G&&S&&I&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let l=await y.handle(W,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let s=K.renderOpts.pendingWaitUntil;s&&o.waitUntil&&(o.waitUntil(s),s=void 0);let a=K.renderOpts.collectedTags;if(!D)return await (0,m.sendResponse)(B,X,l,s),null;{let e=await l.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(l.headers);a&&(t[v.NEXT_CACHE_TAGS_HEADER]=a),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=v.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,o=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=v.INFINITE_CACHE?!1!==n&&n>0?N.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:l.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:o}}}}catch(t){throw(null==n?void 0:n.isStale)&&await y.onRequestError(e,t,{routerKind:"App Router",routePath:x,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:S})},!1,A),t}},Q=async(l,a)=>{try{var r,i;let l=await y.handleResponse({req:e,nextConfig:N,cacheKey:H,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:$,isRoutePPREnabled:!1,isOnDemandRevalidate:S,revalidateOnlyGenerated:I,responseGenerator:J,waitUntil:o.waitUntil,isMinimalMode:G});if(!D)return;if((null==l||null==(r=l.value)?void 0:r.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(i=l.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});G||t.setHeader("x-nextjs-cache",S?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),T&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let s=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);G&&D||s.delete(v.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||t.getHeader("Cache-Control")||s.get("Cache-Control")||s.set("Cache-Control",(0,h.getCacheControlHeader)(l.cacheControl)),await (0,m.sendResponse)(B,X,new Response(l.value.body,{headers:s,status:l.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await y.onRequestError(e,t,{routerKind:"App Router",routePath:j,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:S})},!1,A),D)throw t;await (0,m.sendResponse)(B,X,new Response(null,{status:500}));return}finally{(()=>{if(!l)return;let e=t.statusCode;l.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(l.setStatus({code:s.SpanStatusCode.ERROR}),l.setAttribute("error.type",e.toString()));let n=U.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let o=n.get("next.route")||j,r=`${L} ${o}`;l.setAttributes({"next.route":o,"http.route":o,"next.span_name":r}),l.updateName(r),a&&a!==l&&(a.setAttribute("http.route",o),a.updateName(r))})()}};if(V&&z)await Q(z,void 0);else{let t=U.getActiveScopeSpan();await U.withPropagatedContext(e.headers,()=>U.trace(d.BaseServerSpan.handleRequest,{spanName:`${L} ${x}`,kind:s.SpanKind.SERVER,attributes:{"http.method":L,"http.target":e.url}},e=>Q(e,t)),void 0,!V)}}e.s(["handler",0,_,"patchFetch",0,function(){return(0,o.patchFetch)({workAsyncStorage:x,workUnitAsyncStorage:E})},"routeModule",0,y,"serverHooks",0,b,"workAsyncStorage",0,x,"workUnitAsyncStorage",0,E])}];

//# sourceMappingURL=_1c8d__m._.js.map