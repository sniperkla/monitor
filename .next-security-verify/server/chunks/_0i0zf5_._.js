module.exports=[22026,e=>e.a(async(t,o)=>{try{var n=e.i(89171),r=e.i(23667),s=e.i(80533),a=e.i(47185),l=e.i(43185),i=e.i(69683),c=e.i(51631),d=e.i(67723),u=e.i(37034),p=t([s,a,i,d]);[s,a,i,d]=p.then?(await p)():p;let g=u.shellQuote,$=`
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
BIN="$(command -v zeroclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.cargo/bin/zeroclaw" "$HOME/.local/bin/zeroclaw" "$HOME/bin/zeroclaw" "$HOME/.zeroclaw/bin/zeroclaw" "/root/.cargo/bin/zeroclaw" "/root/.local/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/opt/zeroclaw/zeroclaw"; do [ -x "$p" ] && BIN="$p" && break; done
[ -z "$BIN" ] && BIN="$(find "$HOME" /root /usr /opt -maxdepth 4 -name zeroclaw -type f -perm -111 2>/dev/null | head -1 || true)"
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | head -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.zeroclaw/config.toml" ] && CFG=1
echo "CONFIG=$CFG"
PROC=0; (pgrep -x zeroclaw >/dev/null 2>&1 || pgrep -x zeroclaw >/dev/null 2>&1) && PROC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q 42617 || command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q 42617) && PORT=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
INITD=0; ps -p 1 -o comm= 2>/dev/null | grep -qx systemd && INITD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
GZP=0; command -v gzip >/dev/null 2>&1 && GZP=1
PROCP=0; command -v pgrep >/dev/null 2>&1 && PROCP=1
TARP=0; command -v tar >/dev/null 2>&1 && TARP=1
echo "PROC=$PROC"; echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PORT=$PORT"
echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"; echo "CURL=$CURLP"; echo "TAR=$TARP"; echo "GZIP=$GZP"; echo "PROCP=$PROCP"
`;async function m(e){try{let t=await (0,r.getServerSession)(s.authOptions);if(!t)return n.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let o=await e.json(),{connectionId:a,action:i}=o;if((!a||!i)&&"job"!==i)return n.NextResponse.json({success:!1,error:"Missing connectionId or action"},{status:400});if("job"===i)return(0,l.dispatchWithLiveLogs)(o,()=>({}));return(0,l.dispatchWithLiveLogs)(o,(e,o)=>f(e,t,o))}catch(e){return c.logger.error("[agents/zeroclaw] POST failed:",e?.message),n.NextResponse.json({success:!1,error:e?.message||"Request failed"},{status:500})}}async function f(e,t,o=[]){try{let{connectionId:t,action:r,config:s={},purge:l=!1}=e,c=await (0,a.getSshConfig)(t),u=async(e,t,n={})=>{let r=await (0,a.execCommand)(c,t,{pool:!1,timeoutMs:6e4,...n}),s=((r.stdout||"")+(r.stderr||"")).trim();return o.push(`$ ${e}${s?`
${s.slice(0,2500)}`:""}`),r},p=e=>Buffer.from(String(e),"utf8").toString("base64"),m=(0,d.parseInst)(e),f=(0,d.homeDir)("zeroclaw",m),v=(0,d.instancePort)("zeroclaw",m),h=`${f}/daemon.pid`,E=m?`--config-dir "${f}"`:"",w=()=>m?`${_}; p=""; [ -x "${f}/bin/zeroclaw" ] && p="${f}/bin/zeroclaw"; echo "BIN=$p"`:`
      export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
      p="$(command -v zeroclaw 2>/dev/null || true)"
      [ -z "$p" ] && for q in "$HOME/.cargo/bin/zeroclaw" "$HOME/.local/bin/zeroclaw" "$HOME/bin/zeroclaw" "$HOME/.zeroclaw/bin/zeroclaw" "/root/.cargo/bin/zeroclaw" "/root/.local/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/opt/zeroclaw/zeroclaw"; do [ -x "$q" ] && p="$q" && break; done
      [ -z "$p" ] && p="$(find "$HOME" /root /usr /opt -maxdepth 4 -name zeroclaw -type f -perm -111 2>/dev/null | head -1 || true)"
      echo "BIN=$p"
    `,_='export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" 2>/dev/null; export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"',b=async e=>{let t=await (0,a.execCommand)(c,w(),{pool:!1,timeoutMs:15e3}),o=(t.stdout||"").match(/BIN=(.*)/)?.[1]?.trim();if(!o)return{ok:!1,out:'zeroclaw binary not found. Please click "Install ZeroClaw" in the Overview tab.'};let n=g(o);if(m){if(await (0,d.sdAvailable)(c)){v&&await (0,a.execCommand)(c,`${_}; ${n} config set gateway.port ${v} --no-interactive 2>/dev/null || true`,{pool:!1,timeoutMs:3e4}),await (0,d.ensureInstanceUnit)(c,"zeroclaw",(0,d.gatewayUnit)("zeroclaw",{description:"ZeroClaw daemon",envLines:["EnvironmentFile=-%h/.zeroclaw-%i/.env","Environment=PATH=%h/.local/bin:%h/.cargo/bin:%h/bin:/usr/local/bin:/usr/bin:/bin"],execStart:'/bin/sh -c \'exec "$( [ -x %h/.zeroclaw-%i/bin/zeroclaw ] && echo %h/.zeroclaw-%i/bin/zeroclaw || echo %h/.cargo/bin/zeroclaw)" dae""mon --config-dir %h/.zeroclaw-%i\'',logFile:"%h/.zeroclaw-%i/logs/daemon.log"}));let t=await (0,d.sdInstanceCtl)(c,"zeroclaw",m,e);if(t)return t}if("status"===e){let e=await (0,a.execCommand)(c,`${_}; res=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && res=1; echo "PROC=$res"`,{pool:!1,timeoutMs:3e4});return{ok:!0,active:/PROC=1/.test(e.stdout||"")}}if("stop"===e)return(0,a.execCommand)(c,`${_}; if [ -f "${h}" ]; then kill $(cat "${h}") 2>/dev/null; sleep 1; kill -9 $(cat "${h}") 2>/dev/null; fi; rm -f "${h}"; echo GW_STOPPED`,{pool:!1,timeoutMs:6e4}).then(e=>({ok:/GW_STOPPED/.test(e.stdout||""),out:((e.stdout||"")+(e.stderr||"")).slice(-400)}));"restart"===e&&await b("stop"),v&&await (0,a.execCommand)(c,`${_}; ${n} config set gateway.port ${v} --no-interactive 2>/dev/null || true`,{pool:!1,timeoutMs:3e4});let t=`${_}; set -a; [ -f "${f}/.env" ] && . "${f}/.env"; set +a; mkdir -p "${f}/logs"; setsid nohup ${n} daemon ${E} >> "${f}/logs/daemon.log" 2>&1 < /dev/null & echo $! > "${h}"; sleep 4; if kill -0 $(cat "${h}") 2>/dev/null; then echo "GW_UP (instance)"; else echo GW_DOWN; tail -n 12 "${f}/logs/daemon.log" 2>/dev/null; fi`;return(0,a.execCommand)(c,t,{pool:!1,timeoutMs:12e4}).then(e=>({ok:/GW_UP/.test(e.stdout||""),out:(e.stdout||"").slice(-500)}))}if("status"===e){let e;e=m?`${_}; res=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && res=1; [ "$res" = 1 ] && echo PROC_ACTIVE || echo NO_PROC`:`${_}; res=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && res=1; [ "$res" = 1 ] && echo PROC_ACTIVE || { systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && echo SVC_ACTIVE || true; }; if [ "$res" = 0 ]; then for p in $(pgrep -f '[z]eroclaw daem[o]n' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || res=1; done; fi; [ "$res" = 1 ] && echo PROC_ACTIVE || echo NO_PROC`;let t=await (0,a.execCommand)(c,e,{pool:!1,timeoutMs:3e4});return{ok:!0,active:/SVC_ACTIVE|PROC_ACTIVE/.test(t.stdout||"")}}if("stop"===e){let e=m?"":"for p in $(pgrep -f '[z]eroclaw dae[m]on' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || kill -9 $p 2>/dev/null; done; true";return(0,a.execCommand)(c,`${_}; ${n} service stop 2>/dev/null; ${m?"":"systemctl --user stop zeroclaw 2>/dev/null;"} if [ -f "${h}" ]; then kill $(cat "${h}") 2>/dev/null; sleep 1; kill -9 $(cat "${h}") 2>/dev/null; fi; rm -f "${h}"; ${e} echo GW_STOPPED`,{pool:!1,timeoutMs:6e4}).then(e=>({ok:/GW_STOPPED/.test(e.stdout||""),out:((e.stdout||"")+(e.stderr||"")).slice(-400)}))}"restart"===e&&await b("stop");let r=`
        mkdir -p "${f}/logs" "$HOME/.config/systemd/user"
        ${_}; set -a; [ -f "${f}/.env" ] && . "${f}/.env"; set +a
        systemctl --user stop zeroclaw 2>/dev/null || true
        ${m?"":"for p in $(pgrep -f '[z]eroclaw dae[m]on' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || kill -9 $p 2>/dev/null; done; true"}
        sleep 1
        # Enable lingering on Fedora / RHEL so user systemd stays active after SSH disconnects
        loginctl enable-linger $(whoami) 2>/dev/null || sudo -n loginctl enable-linger $(whoami) 2>/dev/null || true
        
        STARTED_VIA=""
        # 1. Write and start systemd user service file if systemctl is available
        if command -v systemctl >/dev/null 2>&1; then
          cat <<'EOF' > "$HOME/.config/systemd/user/zeroclaw.service"
[Unit]
Description=ZeroClaw AI Assistant Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=-%h/.zeroclaw/.env
Environment=PATH=%h/.local/bin:%h/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/sh -c 'exec $(command -v zeroclaw || echo "$HOME/.cargo/bin/zeroclaw") daemon'
Restart=on-failure
RestartSec=3
StandardOutput=append:%h/.zeroclaw/logs/daemon.log
StandardError=append:%h/.zeroclaw/logs/daemon.log

[Install]
WantedBy=default.target
EOF
          systemctl --user daemon-reload 2>/dev/null || true
          systemctl --user enable zeroclaw 2>/dev/null || true
          systemctl --user restart zeroclaw 2>/dev/null || systemctl --user start zeroclaw 2>/dev/null || true
          sleep 2
          if systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active; then
            STARTED_VIA="systemd"
          fi
        fi

        # 2. Nohup fallback if systemd user unit is not running
        if [ -z "$STARTED_VIA" ] && ! pgrep -x zeroclaw >/dev/null 2>&1 && ! pgrep -x zeroclaw >/dev/null 2>&1; then
          setsid env -i HOME="$HOME" PATH="$PATH" sh -c 'set -a; [ -f "${f}/.env" ] && . "${f}/.env"; set +a; exec '"${n}"' dae""mon' >> "${f}/logs/daemon.log" 2>&1 < /dev/null &
          echo $! > "${h}"
          sleep 3
          if pgrep -x zeroclaw >/dev/null 2>&1 || pgrep -x zeroclaw >/dev/null 2>&1; then
            STARTED_VIA="nohup"
          fi
        fi

        if (systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active) || pgrep -x zeroclaw >/dev/null 2>&1 || kill -0 $(cat "${h}" 2>/dev/null) 2>/dev/null; then
          echo "GW_UP ($STARTED_VIA)"
        else
          echo "GW_DOWN"
          echo "=== RECENT_LOG ==="
          tail -n 25 "${f}/logs/daemon.log" 2>/dev/null || true
          command -v journalctl >/dev/null 2>&1 && journalctl --user -u zeroclaw -n 20 --no-pager 2>/dev/null || true
        fi
      `;return(0,a.execCommand)(c,r,{pool:!1,timeoutMs:12e4}).then(e=>({ok:/GW_UP/.test(e.stdout||""),out:(e.stdout||"").slice(-600)}))},x=async(e=24)=>{let t=(await b("status")).active;for(let o=0;!t&&o<e;o+=6)await new Promise(e=>setTimeout(e,6e3)),t=(await b("status")).active;return t};if("status"===r){let e=await (0,a.execCommand)(c,$,{pool:!0,timeoutMs:3e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim(),o="SET"===t("BIN");return n.NextResponse.json({success:!0,installed:o,version:o?t("VERSION"):null,running:"1"===t("USVC")||"1"===t("SSVC")||"1"===t("PROC"),hasConfig:"1"===t("CONFIG"),prereqs:{curl:"1"===t("CURL"),tar:"1"===t("TAR"),systemd:"1"===t("SYSTEMD"),passwordlessSudo:"1"===t("SUDO")}})}if("instances"===r){let e=await (0,d.listInstances)(c,"zeroclaw");return n.NextResponse.json({success:!0,instances:e})}if("spawn-instance"===r){let e=String(s&&s.tag||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,24);if(!e)return n.NextResponse.json({success:!1,error:"Instance tag is required"},{status:400});let t=await (0,a.execCommand)(c,`mkdir -p "${f}/logs" "${f}/bin" "${f}/data" "${f}/workspace"; if [ ! -f "${f}/config.toml" ]; then printf 'schema_version = 3\\n' > "${f}/config.toml"; fi; mkdir -p "${f}/bin"; SRC=$(command -v zeroclaw 2>/dev/null || echo "$HOME/.cargo/bin/zeroclaw"); if [ -x "$SRC" ]; then cp -f "$SRC" "${f}/bin/zeroclaw"; chmod 755 "${f}/bin/zeroclaw"; fi; echo FRESH_HOME_READY`,{pool:!1,timeoutMs:3e4}),r={ok:/FRESH_HOME_READY/.test(t.stdout||""),existed:!1};if(r.ok||o.push(`> [spawn] home seed did not confirm: ${((t.stdout||"")+(t.stderr||"")).slice(-300)}`),r.existed||await (0,a.execCommand)(c,`export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"; SRC=$(command -v zeroclaw 2>/dev/null || echo "$HOME/.cargo/bin/zeroclaw"); mkdir -p "${f}/bin"; if [ -x "$SRC" ]; then cp -f "$SRC" "${f}/bin/zeroclaw"; chmod 755 "${f}/bin/zeroclaw"; echo BIN_COPIED; else echo BIN_SRC_MISSING; fi`,{pool:!1,timeoutMs:3e4}),v){let e=await (0,a.execCommand)(c,w(),{pool:!1,timeoutMs:15e3}),t=(e.stdout||"").match(/BIN=(.*)/)?.[1]?.trim();t&&await (0,a.execCommand)(c,`${_}; ${g(t)} config set gateway.port ${v} --config-dir "${f}" --no-interactive 2>/dev/null || true`,{pool:!1,timeoutMs:3e4})}return n.NextResponse.json({success:r.ok,instance:e,existed:r.existed,started:!1,needsConfiguration:!0,error:r.ok?void 0:`Failed to create instance "${e}" home. See log.`,output:`Instance "${e}" created fully isolated (nothing seeded from default). Add its own provider API key, model and bot token, then Save & Start — give each instance its OWN bot token so they don't fight over the same Telegram bot.`,log:o})}if("details"===r){let e=`
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
BIN="";
if [ -n "${m}" ] && [ -x "${f}/bin/zeroclaw" ]; then BIN="${f}/bin/zeroclaw"; fi
[ -z "$BIN" ] && BIN="$(command -v zeroclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.cargo/bin/zeroclaw" "$HOME/.local/bin/zeroclaw" "$HOME/bin/zeroclaw" "$HOME/.zeroclaw/bin/zeroclaw" "/root/.cargo/bin/zeroclaw" "/root/.local/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/opt/zeroclaw/zeroclaw"; do [ -x "$p" ] && BIN="$p" && break; done
[ -z "$BIN" ] && BIN="$(find "$HOME" /root /usr /opt -maxdepth 4 -name zeroclaw -type f -perm -111 2>/dev/null | head -1 || true)"
echo "===TOML_B64==="
base64 < "${f}/config.toml" 2>/dev/null || true
echo "===RUNNING==="
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PROC=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && PROC=1
if [ "$PROC" = 0 ] && [ -z "${m}" ]; then
  DEFAULT_DAEMON=0; for p in $(pgrep -f '[z]eroclaw daem[o]n' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || DEFAULT_DAEMON=1; done; [ "$DEFAULT_DAEMON" = 1 ] && PROC=1
fi
echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PROC=$PROC"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | head -1 | cut -c1-40
echo "===MODEL==="
[ -f "${f}/config.toml" ] && grep -E '^\\s*(model|model_provider|default_model)\\s*=' "${f}/config.toml" 2>/dev/null | head -1 | cut -d'"' -f2
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===SKILLS==="
[ -d "${f}/skills" ] && ls -1 "${f}/skills" 2>/dev/null | grep -v '^\\.' || true
[ -d "${f}/workspace/skills" ] && ls -1 "${f}/workspace/skills" 2>/dev/null | grep -v '^\\.' || true
[ -d "${f}/sop" ] && ls -1 "${f}/sop" 2>/dev/null | grep -v '^\\.' | sed 's/\\.md$//' || true
echo "===ZCSKILLS==="
# ZeroClaw manages skills per config-dir via its CLI — list what's installed
[ -n "$BIN" ] && "$BIN" skills list ${E} 2>/dev/null || true
echo "===PROMPT_B64==="
{ base64 < "${f}/data/PROMPT.md" || base64 < "${f}/workspace/PROMPT.md" || base64 < "${f}/prompt.txt" || base64 < "${f}/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${f}/data/SOUL.md" || base64 < "${f}/workspace/SOUL.md" || base64 < "${f}/data/IDENTITY.md" || base64 < "${f}/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
{ base64 < "${f}/data/USER.md" || base64 < "${f}/workspace/USER.md"; } 2>/dev/null || true
echo "===AGENTS_B64==="
{ base64 < "${f}/data/AGENTS.md" || base64 < "${f}/workspace/AGENTS.md"; } 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${f}/data/MEMORY.md" || base64 < "${f}/workspace/MEMORY.md" || base64 < "${f}/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===ENV_B64==="
base64 < "${f}/.env" 2>/dev/null || true
echo "===ENVKEYS==="
[ -f "${f}/.env" ] && grep -oE '^[A-Z_][A-Z0-9_]*' "${f}/.env" 2>/dev/null | sort -u | head -50
`,t=(await (0,a.execCommand)(c,e,{pool:!0,timeoutMs:6e4})).stdout||"",o=(e,o)=>{let n=`===${e}===`,r=t.indexOf(n);if(r<0)return"";let s=r+n.length;if(!o)return t.slice(s).trim();let a=`===${o}===`,l=t.indexOf(a,s);return(l>=0?t.slice(s,l):t.slice(s)).trim()},r="";try{r=Buffer.from(o("TOML_B64","RUNNING"),"base64").toString("utf8")}catch{}let s="";try{s=Buffer.from(o("ENV_B64","ENVKEYS"),"base64").toString("utf8")}catch{}let l=o("BINPATH","SKILLS"),i=/USVC=1|SSVC=1|PROC=1/.test(o("RUNNING","VERSION")),d=o("SKILLS","ZCSKILLS").split("\n").map(e=>e.trim()).filter(Boolean);for(let e of o("ZCSKILLS","PROMPT_B64").split("\n")){let t=e.match(/^\s+([a-zA-Z0-9][\w-]*)\s+v[\d.]+/);t&&d.push(t[1])}let u="";try{u=Buffer.from(o("PROMPT_B64","SOUL_B64"),"base64").toString("utf8")}catch{}let p="";try{p=Buffer.from(o("SOUL_B64","USER_B64"),"base64").toString("utf8")}catch{}let g="";try{g=Buffer.from(o("USER_B64","AGENTS_B64"),"base64").toString("utf8")}catch{}let $="";try{$=Buffer.from(o("AGENTS_B64","MEMORY_B64"),"base64").toString("utf8")}catch{}let v="";try{v=Buffer.from(o("MEMORY_B64","ENV_B64"),"base64").toString("utf8")}catch{}return n.NextResponse.json({success:!0,installed:!!l,version:o("VERSION","MODEL")||null,model:o("MODEL","BINPATH")||null,running:i,binPath:l||null,service:/SSVC=1/.test(t)?"system":/USVC=1/.test(t)?"user":/PROC=1/.test(t)?"process":null,hasSystemd:!0,configJson:r||"",envText:s||"",envKeys:o("ENVKEYS").split("\n").map(e=>e.trim()).filter(Boolean),skills:[...new Set(d)],systemPrompt:u,promptFiles:{"PROMPT.md":u,"SOUL.md":p,"USER.md":g,"AGENTS.md":$,"MEMORY.md":v}})}if("save-prompt"===r){let e=String(s.prompt||""),t=s.file||"PROMPT.md",o=Buffer.from(e,"utf8").toString("base64"),r=`mkdir -p "${f}/data" "${f}/workspace"
`;return r+=`for f in PROMPT.md SOUL.md IDENTITY.md USER.md AGENTS.md MEMORY.md; do [ -f "${f}/data/$f" ] || [ ! -f "${f}/workspace/$f" ] || cp "${f}/workspace/$f" "${f}/data/$f"; done
`,"SOUL.md"===t||"IDENTITY.md"===t?r+=`echo "${o}" | base64 -d > "${f}/data/SOUL.md"
echo "${o}" | base64 -d > "${f}/data/IDENTITY.md"
`:"USER.md"===t?r+=`echo "${o}" | base64 -d > "${f}/data/USER.md"
`:"AGENTS.md"===t?r+=`echo "${o}" | base64 -d > "${f}/data/AGENTS.md"
`:"MEMORY.md"===t?r+=`echo "${o}" | base64 -d > "${f}/data/MEMORY.md"
`:r+=`echo "${o}" | base64 -d > "${f}/data/PROMPT.md"
echo "${o}" | base64 -d > "${f}/prompt.txt"
echo "${o}" | base64 -d > "${f}/SYSTEM_PROMPT.md"
`,await (0,a.execCommand)(c,r,{pool:!1,timeoutMs:3e4}),!1!==s.restart&&await b("restart"),n.NextResponse.json({success:!0,file:t})}if("uninstall"===r){m?(await (0,d.sdInstanceCtl)(c,"zeroclaw",m,"stop"),await u("stop instance (pidfile-scoped)",`if [ -f "${h}" ]; then p=$(cat "${h}"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${h}"; fi; true`)):(await u("stop & unregister service",`${_}; p="$(command -v zeroclaw 2>/dev/null)"; [ -n "$p" ] && $p service uninstall 2>/dev/null; systemctl --user disable --now zeroclaw 2>/dev/null; true`),await u("stop stray processes","timeout 15 pkill -f '[z]eroclaw dae[m]on' 2>/dev/null; true"));let e=m?"":'rm -f "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" /usr/local/bin/zeroclaw; ',t=!m&&l?"timeout 15 pkill -f '[z]eroclaw dae[m]on' 2>/dev/null; rm -rf \"$HOME/.zeroclaw-\"* 2>/dev/null; ":"",r=m?`rm -rf "${f}"; [ ! -e "${f}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`:l?`${t}${e}rm -rf "${f}"; echo REMOVED_ALL`:`${e}rm -rf "${f}/logs"; echo REMOVED_CODE`,s=await u(m?"remove instance (isolated home)":l?"remove binary & all data":"remove binary (config kept)",r),a=/REMOVED/.test(s.stdout||"");return n.NextResponse.json({success:a,purged:l,log:o})}if("install"===r){let e=await (0,a.execCommand)(c,$,{pool:!1,timeoutMs:3e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim(),r="1"===t("SUDO");if("1"!==t("CURL")||"1"!==t("TAR")||"1"!==t("GZIP")||"1"!==t("PROCP")){let e=["curl","tar","gzip"].filter(e=>"curl"===e?"1"!==t("CURL"):"gzip"===e?"1"!==t("GZIP"):"1"!==t("TAR")).join(" ")||"curl",o=`export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export DEBIAN_FRONTEND=noninteractive
S="${r?"sudo -n":""}"
(command -v apt-get >/dev/null 2>&1 && { $S apt-get update -qq 2>/dev/null || $S apt-get update -qq 2>/dev/null; }; $S apt-get install -y ${e}) < /dev/null ||
(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing ${e}) < /dev/null ||
(command -v yum    >/dev/null 2>&1 && $S yum install -y ${e}) < /dev/null ||
(command -v zypper >/dev/null 2>&1 && $S zypper --gpg-auto-import-keys --non-interactive install ${e}) < /dev/null ||
(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed ${e}) < /dev/null ||
(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache ${e}) < /dev/null ||
(command -v pgrep >/dev/null 2>&1) ||
(command -v apt-get >/dev/null 2>&1 && $S apt-get install -y procps) < /dev/null ||
(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing procps-ng) < /dev/null ||
(command -v yum    >/dev/null 2>&1 && $S yum install -y procps-ng) < /dev/null ||
(command -v zypper >/dev/null 2>&1 && $S zypper --gpg-auto-import-keys --non-interactive install procps) < /dev/null ||
(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed procps-ng) < /dev/null ||
(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache procps) < /dev/null ||
true
echo PREREQ_SKIPPED`;await u(`install prerequisites (${e})`,`echo '${p(o)}' | base64 -d | sh 2>&1 | tail -5`,{timeoutMs:3e5})}let l=0,d=`
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
        mkdir -p "${f}/logs" "$HOME/.local/bin" "$HOME/.cargo/bin"
        # Alpine/musl: the official installer assumes glibc — install the musl
        # release tarball directly (zeroclaw ships a static musl target).
        MUSL=0; ldd /bin/busybox 2>/dev/null | grep -qi musl && MUSL=1 || { [ -f /etc/alpine-release ] && MUSL=1; }
        if [ "$MUSL" = 1 ]; then
          mkdir -p /tmp/zcmusl && cd /tmp/zcmusl
          if curl -fsSL -o zcm.tar.gz https://github.com/zeroclaw-labs/zeroclaw/releases/download/v0.8.4/zeroclaw-x86_64-unknown-linux-musl.tar.gz 2>/dev/null; then
            tar -xzf zcm.tar.gz zeroclaw 2>/dev/null && mv -f zeroclaw "$HOME/.cargo/bin/zeroclaw" && chmod 755 "$HOME/.cargo/bin/zeroclaw" && echo "MUSL_INSTALL_SUCCESS"
          else
            echo "MUSL_TARBALL_UNAVAILABLE - building from source is required on Alpine"
          fi
        fi
        if curl -fsSL https://raw.githubusercontent.com/zeroclaw-labs/zeroclaw/master/install.sh | bash 2>&1; then
          echo "OFFICIAL_INSTALLER_SUCCESS"
        else
          echo "Official installer returned non-zero, trying cargo fallback..."
          if command -v cargo >/dev/null 2>&1; then
            cargo install zeroclaw 2>&1 || true
          fi
        fi
      `,m=await (0,i.execDetached)(c,d,{pollMs:3e3,timeoutMs:12e5,onLine:e=>{++l<=400&&o.push(e)}});o.push(`$ official installer${0!==m.code?` — exited ${m.code}`:" — finished"}${l>400?` (${l} lines total)`:""}${m.stderr?`
${m.stderr.slice(0,300)}`:""}`);let v=await (0,a.execCommand)(c,w(),{pool:!1,timeoutMs:3e4}),h=(v.stdout||"").match(/BIN=(.*)/)?.[1]?.trim();if(!h)return n.NextResponse.json({success:!1,error:"Installer finished but the zeroclaw binary was not found — see log.",log:o});await u("zeroclaw --version",`${_}; ${g(h)} --version 2>&1 | head -1`,{timeoutMs:6e4}),await (0,a.execCommand)(c,`
        mkdir -p "${f}"
        if [ ! -f "${f}/config.toml" ]; then
          printf 'schema_version = 3\\n' > "${f}/config.toml"
        else
          # Clean up any previously generated invalid channels_config without bot_token
          python3 -c "
import os, re
p = os.path.expandvars('${f}/config.toml')
if os.path.exists(p):
    t = open(p).read()
    if 'bot_token' not in t and '[channels_config' in t:
        t = re.sub(r'\\[channels_config[^\\]]*\\][\\s\\S]*?(?=\\n\\[|$)', '', t)
        open(p, 'w').write(t.strip() + '\\n')
" 2>/dev/null || true
        fi
      `,{pool:!1,timeoutMs:15e3});let E=s&&s.env||{},x=s&&s.settings||{},O=Object.keys(E).filter(e=>null!=E[e]&&""!==E[e]),R=Object.keys(x).filter(e=>null!=x[e]&&""!==x[e]).length>0;if(O.length>0){let e=p(O.map(e=>`${e}=${E[e]}`).join("\n")),t=`import os, base64
lines_raw = base64.b64decode('${e}').decode('utf-8').splitlines()
ep = os.path.expandvars('${f}/.env')
os.makedirs(os.path.dirname(ep), exist_ok=True)
existing = open(ep).read().splitlines() if os.path.exists(ep) else []
upsert = {}
for ln in lines_raw:
    idx = ln.find('=')
    if idx > 0: upsert[ln[:idx]] = ln[idx+1:]
result = []
keys_done = set()
for ln in existing:
    idx = ln.find('=')
    if idx > 0 and ln[:idx] in upsert:
        result.append(ln[:idx] + '=' + upsert[ln[:idx]])
        keys_done.add(ln[:idx])
    else:
        result.append(ln)
for k, v in upsert.items():
    if k not in keys_done: result.append(k + '=' + v)
open(ep, 'w').write('\\n'.join(result) + '\\n')
os.chmod(ep, 0o600)
print('ENV_UPDATED')`;await u("write ~/.zeroclaw/.env",`echo '${p(t)}' | base64 -d | python3`,{timeoutMs:3e4})}if(R||E.TELEGRAM_BOT_TOKEN||E.TELEGRAM_ALLOWED_USERS||E.OPENROUTER_API_KEY||E.OPENAI_API_KEY||E.ANTHROPIC_API_KEY||E.MODEL||E.ZEROCLAW_MODEL){let e=p(JSON.stringify(x)),t=p(JSON.stringify(E)),o=`import os, re, base64, json
s = json.loads(base64.b64decode('${e}').decode('utf-8'))
e = json.loads(base64.b64decode('${t}').decode('utf-8'))
p = os.path.expandvars('${f}/config.toml')
os.makedirs(os.path.dirname(p), exist_ok=True)
text = open(p).read() if os.path.exists(p) else ''
NL = chr(10)
def drop(content, header_pat):
    while True:
        out, skipping, removed = [], False, False
        for ln in content.split(NL):
            if re.fullmatch(header_pat, ln.strip()):
                skipping = True
                removed = True
                continue
            if skipping and ln.startswith('['):
                skipping = False
            if not skipping:
                out.append(ln)
        content = NL.join(out)
        if not removed:
            return content
# strip legacy top-level keys — 0.8.x ignores them (provider lives under [providers.models.*])
pre = text.find(NL + '[')
head, tail = (text, '') if pre < 0 else (text[:pre + 1], text[pre + 1:])
head = re.sub(r'(?m)^(api_key|model|default_model)[ \\t]*=.*$', '', head)
text = head + tail
# strip legacy/malformed channel sections (pre-0.8 schema)
text = drop(text, r'\\[channels_config\\.telegram]')
text = drop(text, r'\\[channels_config]')
text = drop(text, r'\\[channels\\.telegram]')
# model provider profile — ZeroClaw 0.8+ native schema
prov = None
base_url_override = ''
key = ''
if e.get('OPENROUTER_API_KEY'):
    prov = 'openrouter'
elif e.get('OPENAI_API_KEY'):
    prov = 'openai'
elif e.get('ANTHROPIC_API_KEY'):
    prov = 'anthropic'
elif e.get('CUSTOM_LLM_API_KEY') and e.get('OPENAI_BASE_URL'):
    prov = 'openai'
    base_url_override = e.get('OPENAI_BASE_URL') or ''
if prov:
    key = e.get(prov.upper() + '_API_KEY') or e.get('CUSTOM_LLM_API_KEY') or e.get('API_KEY') or s.get('api_key') or ''
    model = (s.get('model') or s.get('default_model') or e.get('MODEL') or e.get('ZEROCLAW_MODEL') or e.get('DEFAULT_MODEL') or '')
    if key:
        header = '[providers.models.' + prov + '.default]'
        text = drop(text, re.escape(header))
        block = header + NL + 'api_key = "' + key + '"'
        if base_url_override:
            block += NL + 'base_url = "' + base_url_override + '"'
        if model:
            block += NL + 'model = "' + model + '"'
        text = text.rstrip(NL) + NL + NL + block + NL
# telegram channel alias — user access is granted via 'zeroclaw channel bind-telegram <id>'
tok = e.get('TELEGRAM_BOT_TOKEN') or s.get('telegram_token') or ''
if tok:
    text = drop(text, r'\\[channels\\.telegram\\.[^\\]]+]')
    block = '[channels.telegram.default]' + NL + 'enabled = true' + NL + 'bot_token = "' + tok + '"' + NL
    text = text.rstrip(NL) + NL + NL + block
# agent binding — 0.8+ channels only poll for an ENABLED agent bound to a channel
if tok and prov and key:
    text = drop(text, re.escape('[agents.default]'))
    text = drop(text, re.escape('[risk_profiles.personal]'))
    text = drop(text, re.escape('[risk_profiles.personal.default]'))
    agent = '[agents.default]' + NL + 'enabled = true' + NL + 'model_provider = "' + prov + '.default"' + NL + 'channels = ["telegram.default"]' + NL + 'risk_profile = "personal"' + NL
    text = text.rstrip(NL) + NL + NL + '[risk_profiles.personal]' + NL + 'level = "supervised"' + NL + NL + agent
if 'schema_version' not in text:
    text = 'schema_version = 3' + NL + text
open(p, 'w').write(text.strip(NL) + NL)
print('ZEROCLAW_CONFIG_MERGED')`;await u("merge ~/.zeroclaw/config.toml",`echo '${p(o)}' | base64 -d | python3 2>&1`,{timeoutMs:3e4})}let S="1"===t("INITD");S?await u("register service",`${_}; ${g(h)} service install 2>&1 | tail -3 || true`,{timeoutMs:6e4}):o.push("$ register service — skipped (using background nohup daemon mode)");let N=await b("start"),k=N.ok?S?"systemd-user":"service/nohup":"manual";N.ok?await u("start daemon","echo GW_UP"):o.push("$ start daemon — deferred: no LLM API key configured yet. Add your API key and bot token in the Environment tab, then click Restart.");let T=async()=>{let e=await (0,a.execCommand)(c,$,{pool:!1,timeoutMs:6e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim();return"1"===t("USVC")||"1"===t("SSVC")||"1"===t("PROC")};await new Promise(e=>setTimeout(e,2e3));let A=await T();return n.NextResponse.json({success:!0,installed:!0,running:A,startMethod:k,version:t("VERSION"),warning:A?null:"Daemon is not running yet — add your API key and Telegram bot token in the Environment tab, then click Restart.",log:o})}if("gateway"===r){let e=s.op||"status",t=await b(e),o=t.active;return void 0===o&&!1!==t.ok&&"stop"!==e&&(o=await x()),n.NextResponse.json({success:!1!==t.ok,op:e,active:o,output:t.out||""})}if("logs"===r){let e=Math.min(Number(s.lines||300),1e3),t=((await (0,a.execCommand)(c,`${_}; journalctl --user -u zeroclaw --no-pager -n ${e} 2>/dev/null | grep -v '^-- No entries --' | grep -v '^-- Logs begin' | tail -n ${e} > /tmp/.zc-jl.txt; if [ -s /tmp/.zc-jl.txt ]; then cat /tmp/.zc-jl.txt; else tail -n ${e} "${f}/logs/daemon.log" 2>/dev/null || tail -n ${e} "${f}/logs/dae""mon-nohup.log" 2>/dev/null || tail -n ${e} "${f}/logs/daem""on.stderr.log" 2>/dev/null || { LOG=$(ls -1t "${f}/logs/"*.log 2>/dev/null | head -1); [ -n "$LOG" ] && tail -n ${e} "$LOG"; } || echo "(no log file found in ~/.zeroclaw/logs/ — daemon may have exited early)"; fi; rm -f /tmp/.zc-jl.txt`,{pool:!1,timeoutMs:3e4})).stdout||"").slice(-2e5);return n.NextResponse.json({success:!0,data:t,size:t.length,file:"journal::user/zeroclaw | ~/.zeroclaw/logs/daemon.log"})}if("reconfigure"===r){let e=s&&s.env||{},t=s&&s.settings||{},r=Object.keys(e).filter(t=>null!=e[t]&&""!==e[t]),l=Object.keys(t).filter(e=>null!=t[e]&&""!==t[e]).length>0;if(0===r.length&&!l)return n.NextResponse.json({success:!1,error:"No settings or env keys to update"},{status:400});if(r.length>0){let t=p(r.map(t=>`${t}=${e[t]}`).join("\n")),s=`import os, base64
lines_raw = base64.b64decode('${t}').decode('utf-8').splitlines()
ep = os.path.expanduser('~/.zeroclaw/.env')
os.makedirs(os.path.dirname(ep), exist_ok=True)
existing = open(ep).read().splitlines() if os.path.exists(ep) else []
upsert = {}
for ln in lines_raw:
    idx = ln.find('=')
    if idx > 0: upsert[ln[:idx]] = ln[idx+1:]
result = []
keys_done = set()
for ln in existing:
    idx = ln.find('=')
    if idx > 0 and ln[:idx] in upsert:
        result.append(ln[:idx] + '=' + upsert[ln[:idx]])
        keys_done.add(ln[:idx])
    else:
        result.append(ln)
for k, v in upsert.items():
    if k not in keys_done: result.append(k + '=' + v)
open(ep, 'w').write('\\n'.join(result) + '\\n')
os.chmod(ep, 0o600)
print('ENV_UPDATED')`,a=p(s),l=await u("write ~/.zeroclaw/.env",`echo '${a}' | base64 -d | python3`,{timeoutMs:3e4});if(!/ENV_UPDATED/.test(l.stdout||""))return n.NextResponse.json({success:!1,error:"Failed to write ~/.zeroclaw/.env",log:o})}if(l||e.TELEGRAM_BOT_TOKEN||e.TELEGRAM_ALLOWED_USERS||e.OPENROUTER_API_KEY||e.OPENAI_API_KEY||e.ANTHROPIC_API_KEY||e.MODEL||e.ZEROCLAW_MODEL){let n=p(JSON.stringify(t)),r=p(JSON.stringify(e)),s=`import os, re, base64, json
s = json.loads(base64.b64decode('${n}').decode('utf-8'))
e = json.loads(base64.b64decode('${r}').decode('utf-8'))
p = os.path.expandvars('${f}/config.toml')
os.makedirs(os.path.dirname(p), exist_ok=True)
text = open(p).read() if os.path.exists(p) else ''
NL = chr(10)
def drop(content, header_pat):
    while True:
        out, skipping, removed = [], False, False
        for ln in content.split(NL):
            if re.fullmatch(header_pat, ln.strip()):
                skipping = True
                removed = True
                continue
            if skipping and ln.startswith('['):
                skipping = False
            if not skipping:
                out.append(ln)
        content = NL.join(out)
        if not removed:
            return content
# strip legacy top-level keys — 0.8.x ignores them (provider lives under [providers.models.*])
pre = text.find(NL + '[')
head, tail = (text, '') if pre < 0 else (text[:pre + 1], text[pre + 1:])
head = re.sub(r'(?m)^(api_key|model|default_model)[ \\t]*=.*$', '', head)
text = head + tail
# strip legacy/malformed channel sections (pre-0.8 schema)
text = drop(text, r'\\[channels_config\\.telegram]')
text = drop(text, r'\\[channels_config]')
text = drop(text, r'\\[channels\\.telegram]')
# model provider profile — ZeroClaw 0.8+ native schema
prov = None
base_url_override = ''
key = ''
if e.get('OPENROUTER_API_KEY'):
    prov = 'openrouter'
elif e.get('OPENAI_API_KEY'):
    prov = 'openai'
elif e.get('ANTHROPIC_API_KEY'):
    prov = 'anthropic'
if not prov:
    for env_ln in open(ep).read().splitlines() if os.path.exists(ep) else []:
        if env_ln.startswith('OPENROUTER_API_KEY=') and env_ln.split('=', 1)[1].strip():
            prov = 'openrouter'
            break
        elif env_ln.startswith('OPENAI_API_KEY=') and env_ln.split('=', 1)[1].strip():
            prov = 'openai'
            break
        elif env_ln.startswith('ANTHROPIC_API_KEY=') and env_ln.split('=', 1)[1].strip():
            prov = 'anthropic'
            break
    if not prov:
        m_prov = re.search(r'[providers.models.([a-zA-Z0-9_-]+).default]', text)
        if m_prov: prov = m_prov.group(1)
if prov:
    key = e.get(prov.upper() + '_API_KEY') or e.get('API_KEY') or s.get('api_key') or ''
    if not key:
        for env_ln in open(ep).read().splitlines() if os.path.exists(ep) else []:
            if env_ln.startswith(prov.upper() + '_API_KEY=') and env_ln.split('=', 1)[1].strip():
                key = env_ln.split('=', 1)[1].strip()
                break
        if not key:
            m_key = re.search(r'[providers.models.' + re.escape(prov) + r'.default][sS]*?api_keys*=s*"([^"]+)"', text)
            if m_key: key = m_key.group(1)
    model = (s.get('model') or s.get('default_model') or e.get('MODEL') or e.get('ZEROCLAW_MODEL') or e.get('DEFAULT_MODEL') or '')
    if not model:
        m_mod = re.search(r'[providers.models.' + re.escape(prov) + r'.default][sS]*?models*=s*"([^"]+)"', text)
        if m_mod: model = m_mod.group(1)
    if key:
        header = '[providers.models.' + prov + '.default]'
        text = drop(text, re.escape(header))
        block = header + NL + 'api_key = "' + key + '"'
        if model:
            block += NL + 'model = "' + model + '"'
        text = text.rstrip(NL) + NL + NL + block + NL
# telegram channel alias — user access is granted via 'zeroclaw channel bind-telegram <id>'
tok = e.get('TELEGRAM_BOT_TOKEN') or s.get('telegram_token') or ''
if not tok:
    for env_ln in open(ep).read().splitlines() if os.path.exists(ep) else []:
        if env_ln.startswith('TELEGRAM_BOT_TOKEN=') and env_ln.split('=', 1)[1].strip():
            tok = env_ln.split('=', 1)[1].strip()
            break
    if not tok:
        m_tok = re.search(r'[channels.telegram.default][sS]*?bot_tokens*=s*"([^"]+)"', text)
        if m_tok: tok = m_tok.group(1)
if tok:
    text = drop(text, r'\\[channels\\.telegram\\.[^\\]]+]')
    block = '[channels.telegram.default]' + NL + 'enabled = true' + NL + 'bot_token = "' + tok + '"' + NL
    text = text.rstrip(NL) + NL + NL + block
# agent binding — 0.8+ channels only poll for an ENABLED agent bound to a channel
if tok and prov and key:
    text = drop(text, re.escape('[agents.default]'))
    text = drop(text, re.escape('[risk_profiles.personal.default]'))
    agent = '[agents.default]' + NL + 'enabled = true' + NL + 'model_provider = "' + prov + '.default"' + NL + 'channels = ["telegram.default"]' + NL + 'risk_profile = "personal"' + NL
    text = text.rstrip(NL) + NL + NL + '[risk_profiles.personal.default]' + NL + 'level = "supervised"' + NL + NL + agent
if 'schema_version' not in text:
    text = 'schema_version = 3' + NL + text
open(p, 'w').write(text.strip(NL) + NL)
print('ZEROCLAW_CONFIG_MERGED')`,l=p(s),i=await u("merge ~/.zeroclaw/config.toml",`echo '${l}' | base64 -d | python3 2>&1`,{timeoutMs:3e4});o.push(`config-merge result: ${(i.stdout||"").trim().slice(0,300)}`),await (0,a.execCommand)(c,`
          TOKEN="$(grep -oE 'bot_token = "[^"]+"' "${f}/config.toml" 2>/dev/null | cut -d'"' -f2 || grep -oE 'TELEGRAM_BOT_TOKEN=[^ 	
]+' "${f}/.env" 2>/dev/null | cut -d= -f2-)"
          if [ -n "$TOKEN" ]; then
            curl -s "https://api.telegram.org/bot\${TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null 2>&1 || true
          fi
        `,{pool:!1,timeoutMs:15e3})}let i=p(JSON.stringify({"SOUL.md":"# SOUL.md\n\nPersona identity, tone of voice, and character traits for this agent.\n\n- Tone: friendly, concise, and practical\n- Style: direct answer first, short explanation after\n- When unsure, ask one clarifying question instead of guessing\n","USER.md":"# USER.md\n\n## Profile\n- Name: Admin\n- Language: English & Thai\n- Style: provide command lines first, brief explanations after\n\n## Preferences\n- Prefer safe, reversible commands\n- Confirm before any destructive operation\n","MEMORY.md":"# MEMORY.md\n\nLong-term knowledge, decisions, and lessons the agent should remember across sessions.\n\n- Append new lessons as bullet points\n- Keep entries short; one topic per bullet\n"}));await u("seed workspace files",`echo '${i}' | base64 -d | python3 -c "
import json, os, base64, sys
defaults = json.loads(base64.b64decode('${i}').decode('utf8'))
ws = os.path.expanduser('~/.zeroclaw/data')
os.makedirs(ws, exist_ok=True)
created = []
for name, content in defaults.items():
    fp = os.path.join(ws, name)
    if not os.path.exists(fp):
        open(fp, 'w').write(content)
        created.append(name)
print('SEEDED:' + (','.join(created) if created else 'none'))
" 2>&1`,{timeoutMs:3e4});let d=await b("restart");return n.NextResponse.json({success:d.ok,restarted:d.ok,startMethod:d.ok?"process":null,error:d.ok?null:d.out||"gateway did not start after reconfigure — check logs tab",log:o})}if("save-config"===r){let e=String(s.configJson??s.configToml??s.configYaml??"");if(!e.trim())return n.NextResponse.json({success:!1,error:"Empty config"},{status:400});let t=Date.now();await u("backup current config",`mkdir -p "${f}"; [ -f "${f}/config.toml" ] && cp "${f}/config.toml" "${f}/config.toml.bak-${t}"; ls -1t "${f}"/config.toml.bak-* 2>/dev/null | head -3`);let r=await u("write config.toml",`echo '${p(e)}' > /tmp/.zc-cfg.b64 && base64 -d /tmp/.zc-cfg.b64 > "${f}/config.toml" && rm -f /tmp/.zc-cfg.b64 && echo CONFIG_SAVED`);if(!/CONFIG_SAVED/.test(r.stdout||""))return n.NextResponse.json({success:!1,error:"Failed to write config.toml",log:o});let l=!1,i=!1;if(s.restart){let e=await b("restart");if(l=e.ok,!(e.ok&&await x(24))){let e=((await (0,a.execCommand)(c,`tail -n 30 "${f}/logs/daemon.log" 2>/dev/null || journalctl --user -u zeroclaw -n 20 --no-pager 2>/dev/null || true`,{pool:!1,timeoutMs:15e3})).stdout||"").trim(),t=await (0,a.execCommand)(c,`BAK="$(ls -1t "${f}"/config.toml.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${f}/config.toml" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,{pool:!1,timeoutMs:3e4});if(/ROLLED_BACK/.test(t.stdout||"")){i=!0,await b("restart");let o=await x(24);return n.NextResponse.json({success:!1,restarted:o,rolledBack:!0,error:`Your saved config caused the daemon to crash (rolled back to backup). Error:
${e.slice(-600)}`,log:[`Daemon crashed with saved config: ${e.slice(-300)}`,`Automatically restored ${((t.stdout||"").match(/ROLLED_BACK_TO=(.*)/)||[])[1]||"last backup"}`]})}}}return n.NextResponse.json({success:!0,restarted:l,rolledBack:i})}if("backups"===r){let e=((await u("list config backups",`ls -1t "${f}"/config.toml.bak-* 2>/dev/null || true`)).stdout||"").split("\n").map(e=>e.trim()).filter(Boolean);return n.NextResponse.json({success:!0,backups:e})}if("restore-backup"===r){let e=String(s.backup||"");if(!/^[\w./~-]+$/.test(e)||!e.includes("config.toml.bak-"))return n.NextResponse.json({success:!1,error:"Invalid backup path"},{status:400});return await u("restore backup",`cp "${e}" "${f}/config.toml" && echo RESTORED`),s.restart&&(await b("restart"),await x(24)),n.NextResponse.json({success:!0})}if("health"===r){let e=`
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PROC=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && PROC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE '42617${v?`|${v}`:""}') && PORT=1
ALIVE=0; [ $USVC = 1 -o $SSVC = 1 -o $PROC = 1 ] && ALIVE=1
if [ "$ALIVE" = 0 ] && [ -n "${m}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active zeroclaw-gatew""ay@${m} 2>/dev/null | grep -qx active && ALIVE=1
fi
echo "ALIVE=$ALIVE"; echo "PORT=$PORT"
PID=$(cat "${h}" 2>/dev/null)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=not_configured
if [ -f "${f}/config.toml" ] && grep -qiE '(bot_token|token)s*=s*"[0-9]+:' "${f}/config.toml" || { [ -f "${f}/.env" ] && grep -qiE 'TELEGRAM_BOT_TOKEN=[0-9]+:' "${f}/.env"; }; then
  TG=connected
fi
LOGL="$(ls -1t "${f}/logs/"*.log 2>/dev/null | head -1)"
if [ -n "$LOGL" ]; then
  if tail -n 100 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
    TG=error
  elif tail -n 300 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling|channel enabled|started|ready|connected|ok|listening)'; then
    TG=connected
  fi
fi
echo "TG=$TG"
`,t=(await (0,a.execCommand)(c,e,{pool:!1,timeoutMs:45e3})).stdout||"",o=e=>(t.match(RegExp(`${e}=([^\\n]*)`))||[])[1]?.trim();return n.NextResponse.json({success:!0,alive:"1"===o("ALIVE"),portListening:"1"===o("PORT"),uptimeSec:Number(o("UPTIME_SEC")||0),telegram:o("TG")||"unknown",errorCount:0,recentErrors:[]})}if("skills"===r){let e=s.op,t='export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"',o=await (0,a.execCommand)(c,w(),{pool:!1,timeoutMs:15e3}),r=(o.stdout||"").match(/BIN=(.*)/)?.[1]?.trim(),l=r?g(r):"zeroclaw",i=`${t}; ${l} config set skill_bundles.default.directory shared/skills/default ${E} 2>/dev/null; `;if("remove"===e){let e=String(s.name||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid skill name"},{status:400});let t=await (0,a.execCommand)(c,`${i}${l} skills remove ${g(e)} ${E} 2>&1 || rm -rf "${f}/skills/${e}" "${f}/sop/${e}.md" "${f}/sop/${e}" 2>/dev/null; true`,{pool:!1,timeoutMs:3e4}),o=await b("restart");return n.NextResponse.json({success:!0,restarted:o.ok,output:((t.stdout||"")+(t.stderr||"")).slice(-400)})}if("install"===e){let e=String(s.id||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid skill id"},{status:400});let t=e.split("/").pop().replace(/[^a-zA-Z0-9_-]/g,"-").toLowerCase(),o=/^https?:\/\//.test(e)||/\.(git|zip|tgz|tar\.gz)$/.test(e)?`${i}${l} skills install ${g(e)} ${E} 2>&1`:`${i}${l} skills add ${g(t)} --bundle default --description ${g("Skill "+t)} ${E} 2>&1 || { mkdir -p "${f}/skills/${t}" "${f}/sop"; echo "# SOP: ${e}

Execute ${t} standard operating procedure." > "${f}/sop/${t}.md"; echo SCAFFOLLED; }`,r=await (0,a.execCommand)(c,o,{pool:!1,timeoutMs:12e4}),d=!/error|failed|not found/i.test((r.stdout||"")+(r.stderr||""))||/Scaffolded|installed|SCAFFOLLED/i.test(r.stdout||""),u=await b("restart");return n.NextResponse.json({success:d,restarted:u.ok,output:((r.stdout||"")+(r.stderr||"")).slice(-500)})}if("install-content"===e){let e=String(s.name||s.id||"").trim(),o=e.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"").slice(0,64)||"custom-skill",r=String(s.content||"").trim();r||(r=`# ${e}

Skill definition for ${e}.
`);let l=Buffer.from(r,"utf8").toString("base64");await (0,a.execCommand)(c,`${t}; mkdir -p "${f}/skills/${o}"; printf '%s' "${l}" | base64 -d > "${f}/skills/${o}/SKILL.md"`,{pool:!1,timeoutMs:3e4});let i=await b("restart");return n.NextResponse.json({success:!0,restarted:i.ok,output:`Installed skill "${e}" with full content`})}return n.NextResponse.json({success:!1,error:`Unknown skills op: ${e}`},{status:400})}let O=v||42617;if("pairing-approve"===r){let e=String(s.code||"").trim(),t=await (0,a.execCommand)(c,`cat $(ls -1t "${f}/logs/"*.log 2>/dev/null | head -2) 2>/dev/null | tail -n 1000 || true`,{pool:!1,timeoutMs:2e4}),r="telegram-bind"===String(s.platform||""),l=RegExp(`one-time bind code:\\\\s*${e}([^0-9]|$)`,"i");if(e&&(r||l.test(t.stdout||"")))return n.NextResponse.json({success:!0,output:`Bind code ${e} is pending. Open Telegram, send "/bind ${e}" to your bot, then press "Scan Pending Requests" again. (The bind must be confirmed from your own Telegram account, so it cannot be approved from here.)`,log:o});e&&RegExp(`X-Pairing-Code:\\\\s*${e}([^0-9]|$)`,"i").test(t.stdout||"")||await (0,a.execCommand)(c,`
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"
        zeroclaw channel bind-telegram ${g(e)} 2>&1 || true
        # If bot token exists, clear any stale webhooks so long polling works immediately
        TOKEN="$(grep -oE 'bot_token\\s*=\\s*"[^"]+"' "${f}/config.toml" 2>/dev/null | cut -d'"' -f2 || grep -oE 'TELEGRAM_BOT_TOKEN=[^ \\n]+' "${f}/.env" 2>/dev/null | cut -d= -f2)"
        if [ -n "$TOKEN" ]; then
          curl -s "https://api.telegram.org/bot\${TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null 2>&1 || true
        fi
      `,{pool:!1,timeoutMs:15e3});let i=((await (0,a.execCommand)(c,`
        curl -s -w "\\nHTTP_CODE:%{http_code}" -X POST http://127.0.0.1:${O||42617}/pair \
          -H ${g("X-Pairing-Code: "+e)} \
          -H "Content-Type: application/json" \
          -d '{}' 2>/dev/null || true
      `,{pool:!1,timeoutMs:15e3})).stdout||"").trim(),d=/HTTP_CODE:20[0-9]/.test(i)||/token|session|paired|success/i.test(i),u=`import os, re, json, base64
uid = ${JSON.stringify(e)}
p = os.path.expandvars('${f}/config.toml')
text = open(p).read() if os.path.exists(p) else ''
def add_user(content, u):
    for sec in ['[channels_config.telegram]', '[telegram]']:
        if sec in content:
            m = re.search(r'(' + re.escape(sec) + r'[\\s\\S]*?^\\s*(?:allowed_users|allowed_user_ids)\\s*=\\s*\\[)([^\\]]*)(\\])', content, re.M)
            if m:
                raw_items = [x.strip().strip('"\\' ') for x in m.group(2).split(',') if x.strip().strip('"\\' ')]
                unique_items = []
                for item in raw_items:
                    if item and item not in unique_items:
                        unique_items.append(item)
                if u and u not in unique_items:
                    unique_items.append(u)
                new_val = json.dumps(unique_items)
                content = content[:m.start(1)] + m.group(1) + new_val[1:-1] + m.group(3) + content[m.end():]
            else:
                content = content.replace(sec, sec + '\\nallowed_users = [' + json.dumps(u) + ']')
            return content
    return content
if uid and os.path.exists(p) and uid.isdigit():
    open(p, 'w').write(add_user(text, uid).strip() + '\\n')
# Update ~/.zeroclaw/.env TELEGRAM_ALLOWED_USERS
env_p = os.path.expanduser('~/.zeroclaw/.env')
env_text = open(env_p).read() if os.path.exists(env_p) else ''
if uid and uid.isdigit():
    if 'TELEGRAM_ALLOWED_USERS=' in env_text:
        curr = re.search(r'^TELEGRAM_ALLOWED_USERS=(.*)$', env_text, re.M)
        existing_env = [x.strip() for x in (curr.group(1) if curr else '').split(',') if x.strip()]
        if uid not in existing_env:
            existing_env.append(uid)
        env_text = re.sub(r'^TELEGRAM_ALLOWED_USERS=.*$', 'TELEGRAM_ALLOWED_USERS=' + ','.join(existing_env), env_text, flags=re.M)
    else:
        env_text = env_text.rstrip('\\n') + '\\nTELEGRAM_ALLOWED_USERS=' + uid + '\\n'
    open(env_p, 'w').write(env_text)
added = bool(uid) and (os.path.exists(p) and uid in open(p).read() or uid in open(env_p).read())
print('ADDED_TO_ALLOWED_USERS' if added else 'NOT_ADDED')`,m=p(u),$=await (0,a.execCommand)(c,`echo '${m}' | base64 -d | python3 2>&1`,{pool:!1,timeoutMs:3e4}),v=(($.stdout||"")+($.stderr||"")).trim();if(!(/ADDED_TO_ALLOWED_USERS/.test(v)||d))return n.NextResponse.json({success:!1,error:`Failed to approve code: ${v}`,log:o});if(d)return n.NextResponse.json({success:!0,output:`Successfully paired gateway with code "${e}".`,paired:!0,log:o});let h=await b("restart");return n.NextResponse.json({success:!0,output:`Telegram user ID "${e}" added to allowed_users. Daemon restarted: ${h.ok}`,restarted:h.ok,log:o})}if("pairing-list"===r){let e=(await (0,a.execCommand)(c,`FILE="$(ls -1t "${f}/logs/"*.log 2>/dev/null | head -1)"; [ -n "$FILE" ] && tail -n 250 "$FILE" || true`,{pool:!1,timeoutMs:2e4})).stdout||"",t=[],o=await (0,a.execCommand)(c,`curl -s -m 5 -X POST http://127.0.0.1:${O}/admin/paircode/new 2>/dev/null || true`,{pool:!1,timeoutMs:15e3}),r=(o.stdout||"").match(/pairing_code\":\"([0-9]{4,8})\"/)||(o.stdout||"").match(/pairing_code\":\"?([0-9]{4,8})/);if(r&&r[1]&&t.push({code:r[1],platform:"gateway",fresh:!0}),!r){let o=e.split("\n").filter(e=>!/Send:\s*POST \/pair with header/i.test(e)).join("\n"),n=[...o.matchAll(/X-Pairing-Code:\s*([0-9]{6})/gi),...o.matchAll(/[│|]\s*([0-9]{6})\s*[│|]/g),...o.matchAll(/pairing\s+code\s+is\s+([0-9]{6})/gi)],r=n[n.length-1];r&&r[1]&&!t.some(e=>e.code===r[1])&&t.push({code:r[1],platform:"gateway"})}let s=[...e.matchAll(/one-time bind code:\s*([0-9]{4,8})/gi)],l=s[s.length-1];for(let o of(l&&l[1]&&!t.some(e=>e.code===l[1])&&t.push({code:l[1],platform:"telegram-bind"}),[...e.matchAll(/(?:unauthorized|unknown|denied|not allowed)[^\d]*(\d{5,12})/gi),...e.matchAll(/user[_\s]?id[:\s]+(\d{5,12})/gi),...e.matchAll(/from user[:\s]+(\d{5,12})/gi)])){let e=o[1];e&&!t.some(t=>t.code===e)&&t.push({code:e,platform:"telegram"})}let i=await (0,a.execCommand)(c,`CONF="${f}/config.toml"; PT=$(grep -oE 'paired_tokens\\s*=\\s*\\[[^]]*\\]' "$CONF" 2>/dev/null | tr ',' '
' | grep -cE 'enc2|zc_' || echo 0); echo "PAIRED_TOKENS=$PT"`,{pool:!1,timeoutMs:15e3}),d=Number((i.stdout||"").match(/PAIRED_TOKENS=(\d+)/)?.[1]||0);return n.NextResponse.json({success:!0,pending:t,pairedTokens:d,raw:e.slice(-1e3)})}if("pairing-revoke"===r){let e=String(s.which||""),t=String(s.device||"").trim();if("remove-tg"===e){if(!t)return n.NextResponse.json({success:!1,error:"Telegram user id is required"},{status:400});let e=`import os, re
uid = ${JSON.stringify(t)}
env_p = os.path.expanduser('~/.zeroclaw/.env')
e = open(env_p).read() if os.path.exists(env_p) else ''
m = re.search(r'^TELEGRAM_ALLOWED_USERS=(.*)$', e, re.M)
if m:
    users = [x.strip() for x in m.group(1).split(',') if x.strip() and x.strip() != uid]
    e = re.sub(r'^TELEGRAM_ALLOWED_USERS=.*$', 'TELEGRAM_ALLOWED_USERS=' + ','.join(users), e, flags=re.M)
    open(env_p, 'w').write(e)
    print('TG_REMOVED' if uid not in (','.join(users)) else 'TG_STILL_PRESENT')
# /bind stores peers in config.toml [peer_groups.*].external_peers - remove there too
cfg_p = os.path.expandvars('\${HH}/config.toml')
cfg = open(cfg_p).read() if os.path.exists(cfg_p) else ''
if uid in cfg:
    q = chr(34)
    cfg = cfg.replace(q + uid + q + ',', '').replace(', ' + q + uid + q, '').replace(q + uid + q, '')
    open(cfg_p, 'w').write(cfg)
    print('CFG_PEER_REMOVED')
else:
    print('TG_NONE')`,r=await (0,a.execCommand)(c,`echo '${p(e)}' | base64 -d | python3`,{pool:!1,timeoutMs:3e4}),s=/TG_REMOVED|CFG_PEER_REMOVED/.test(r.stdout||"");return await b("restart"),n.NextResponse.json({success:s,output:s?`Removed Telegram user ${t}.`:"User not found in allow-list.",restarted:!0,log:o})}let r="device"===e&&t?`--rotate-device ${g(t)}`:"--rotate",l=((await (0,a.execCommand)(c,`export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"; zeroclaw gateway get-paircode ${r} --port ${O||42617} 2>&1 | head -20`,{pool:!1,timeoutMs:3e4})).stdout||"").trim(),i=!/error|failed/i.test(l);return n.NextResponse.json({success:i,output:i?l||`Pairing revoked (${"device"===e&&t?t:"all devices"}).`:l,log:o})}return n.NextResponse.json({success:!1,error:`Unknown action: ${r}`},{status:400})}catch(e){return c.logger.error("[agents/zeroclaw] action failed:",e?.message),n.NextResponse.json({success:!1,error:e?.message||"Request failed"})}}e.s(["POST",0,m]),o()}catch(e){o(e)}},!1),72962,e=>{"use strict";var t=e.i(8970),o=e.i(74017),n=e.i(96250),r=e.i(59756),s=e.i(61916),a=e.i(74677),l=e.i(69741),i=e.i(16795),c=e.i(87718),d=e.i(95169),u=e.i(47587),p=e.i(66012),m=e.i(70101),f=e.i(26937),g=e.i(10372),$=e.i(93695);e.i(52474);var v=e.i(5232);let h=new t.AppRouteRouteModule({definition:{kind:o.RouteKind.APP_ROUTE,page:"/api/agents/zeroclaw/route",pathname:"/api/agents/zeroclaw",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/agents/zeroclaw/route.js",nextConfigOutput:"",userland:()=>e.r(22026),...{}}),{workAsyncStorage:E,workUnitAsyncStorage:w,serverHooks:_}=h;async function b(e,t,n){n.requestMeta&&(0,r.setRequestMeta)(e,n.requestMeta),h.isDev&&(0,r.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let E="/api/agents/zeroclaw/route";E=E.replace(/\/index$/,"")||"/";let w=await h.prepare(e,t,{srcPage:E,multiZoneDraftMode:!1});if(!w)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:_,deploymentId:b,params:x,nextConfig:O,parsedUrl:R,isDraftMode:S,prerenderManifest:N,routerServerContext:k,isOnDemandRevalidate:T,revalidateOnlyGenerated:A,resolvedPathname:L,clientReferenceManifest:M,serverActionsManifest:P}=w,C=(0,l.normalizeAppPath)(E),y=!!(N.dynamicRoutes[C]||N.routes[L]),I=async()=>((null==k?void 0:k.render404)?await k.render404(e,t,R,!1):t.end("This page could not be found"),null);if(y&&!S){let e=!!N.routes[L],t=N.dynamicRoutes[C];if(t&&!1===t.fallback&&!e){if(O.adapterPath)return await I();throw new $.NoFallbackError}}let z=null;!y||h.isDev||S||(z="/index"===(z=L)?"/":z);let D=!0===h.isDev||!y,U=y&&!D;P&&M&&(0,a.setManifestsSingleton)({page:E,clientReferenceManifest:M,serverActionsManifest:P});let H=e.method||"GET",B=(0,s.getTracer)(),j=B.getActiveScopeSpan(),G=!!(null==k?void 0:k.isWrappedByNextServer),V=!!(0,r.getRequestMeta)(e,"minimalMode"),q=(0,r.getRequestMeta)(e,"incrementalCache")||await h.getIncrementalCache(e,O,N,V);null==q||q.resetRequestCache(),globalThis.__incrementalCache=q;let K={params:x,previewProps:N.preview,renderOpts:{experimental:{authInterrupts:!!O.experimental.authInterrupts,useCacheTimeout:O.experimental.useCacheTimeout},cacheComponents:!!O.cacheComponents,validationLevel:O.experimental.instantInsights.validationLevel,supportsDynamicResponse:D,incrementalCache:q,hmrRefreshHash:(0,r.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:O.cacheLife,staticPageGenerationTimeout:O.staticPageGenerationTimeout,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,o,n,r)=>h.onRequestError(e,t,n,r,k)},sharedContext:{buildId:_,deploymentId:b}},F=new i.NodeNextRequest(e),Y=new i.NodeNextResponse(t),W=c.NextRequestAdapter.fromNodeNextRequest(F,(0,c.signalFromNodeResponse)(t)),Z=async({previousCacheEntry:o})=>{try{if(!V&&T&&A&&!o)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await h.handle(W,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let s=K.renderOpts.pendingWaitUntil;s&&n.waitUntil&&(n.waitUntil(s),s=void 0);let a=K.renderOpts.collectedTags;if(!y)return await (0,p.sendResponse)(F,Y,r,s),null;{let e=await r.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(r.headers);a&&(t[g.NEXT_CACHE_TAGS_HEADER]=a),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let o=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=g.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,n=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=g.INFINITE_CACHE?!1!==o&&o>0?O.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:o,expire:n}}}}catch(t){throw(null==o?void 0:o.isStale)&&await h.onRequestError(e,t,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:T})},!1,k),t}},X=async(r,a)=>{try{var l,i;let r=await h.handleResponse({req:e,nextConfig:O,cacheKey:z,routeKind:o.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:N,isRoutePPREnabled:!1,isOnDemandRevalidate:T,revalidateOnlyGenerated:A,responseGenerator:Z,waitUntil:n.waitUntil,isMinimalMode:V});if(!y)return;if((null==r||null==(l=r.value)?void 0:l.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==r||null==(i=r.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});V||t.setHeader("x-nextjs-cache",T?"REVALIDATED":r.isMiss?"MISS":r.isStale?"STALE":"HIT"),S&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let s=(0,m.fromNodeOutgoingHttpHeaders)(r.value.headers);V&&y||s.delete(g.NEXT_CACHE_TAGS_HEADER),!r.cacheControl||t.getHeader("Cache-Control")||s.get("Cache-Control")||s.set("Cache-Control",(0,f.getCacheControlHeader)(r.cacheControl)),await (0,p.sendResponse)(F,Y,new Response(r.value.body,{headers:s,status:r.value.status||200}));return}catch(t){if(t instanceof $.NoFallbackError||await h.onRequestError(e,t,{routerKind:"App Router",routePath:C,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:T})},!1,k),y)throw t;await (0,p.sendResponse)(F,Y,new Response(null,{status:500}));return}finally{(()=>{if(!r)return;let e=t.statusCode;r.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(r.setStatus({code:s.SpanStatusCode.ERROR}),r.setAttribute("error.type",e.toString()));let o=B.getRootSpanAttributes();if(!o)return;if(o.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${o.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=o.get("next.route")||C,l=`${H} ${n}`;r.setAttributes({"next.route":n,"http.route":n,"next.span_name":l}),r.updateName(l),a&&a!==r&&(a.setAttribute("http.route",n),a.updateName(l))})()}};if(G&&j)await X(j,void 0);else{let t=B.getActiveScopeSpan();await B.withPropagatedContext(e.headers,()=>B.trace(d.BaseServerSpan.handleRequest,{spanName:`${H} ${E}`,kind:s.SpanKind.SERVER,attributes:{"http.method":H,"http.target":e.url}},e=>X(e,t)),void 0,!G)}}e.s(["handler",0,b,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:E,workUnitAsyncStorage:w})},"routeModule",0,h,"serverHooks",0,_,"workAsyncStorage",0,E,"workUnitAsyncStorage",0,w])}];

//# sourceMappingURL=_0i0zf5_._.js.map