module.exports=[67723,e=>e.a(async(t,n)=>{try{var r=e.i(47185),o=t([r]);function a(e,t,n=18e3){if(!t)return null;let r=0,o=`${e}:${t}`;for(let e=0;e<o.length;e++)r=(r<<5)-r+o.charCodeAt(e)|0;let s=n+Math.abs(r)%1e3;return s>=18780&&s<=18799&&(s+=100),s}function s(e,t,n=["api","hook"]){return t?n.map(n=>a(e,`${t}#${n}`)):[]}async function i(e,t){let n=(await (0,r.execCommand)(e,`
DE=0; [ -d "$HOME/.${t}" ] && DE=1
echo "DEFAULT_EXISTS=$DE"
PR=0; [ -f "$HOME/.${t}/daemon.pid" ] && kill -0 $(cat "$HOME/.${t}/daemon.pid") 2>/dev/null && PR=1
[ -f "$HOME/.${t}/gateway.pid" ] && kill -0 $(cat "$HOME/.${t}/gateway.pid") 2>/dev/null && PR=1
if [ "$PR" = 0 ]; then
  { systemctl is-active ${t}-gate""way 2>/dev/null || systemctl is-active ${t} 2>/dev/null || systemctl --user is-active ${t}-gate""way 2>/dev/null || systemctl --user is-active ${t} 2>/dev/null; } | grep -qx active && PR=1
fi
if [ "$PR" = 0 ]; then
    case "${t}" in
      nanobot)
        # Match ANY nanobot gateway, then attribute it by the home token found
        # in its command line. The old pattern required an explicit
        # --config <home>/config.json flag — gateways launched before that flag
        # became standard (bare "nanobot gateway") never matched it, so a
        # perfectly healthy default instance reported as stopped. An empty home
        # token also means "default": a bare launcher has no path to attribute.
        # NBLISTSCAN marks this script's own text so the scan skips itself.
        for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
          [ -r "/proc/$p/cmdline" ] || continue
          C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
          [ -n "$C" ] || continue
          case "$C" in *NBLISTSCAN*) continue;; esac
          case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
          HME=$(echo "$C" | grep -o '\\.${t}[-a-zA-Z0-9_]*' | head -1)
          case "$HME" in ""|".${t}") PR=1; break;; esac
        done
        ;;
    zeroclaw) pgrep -f "zeroclaw.*--config-dir $HOME/.${t}" >/dev/null 2>&1 && PR=1 ;;
    openclaw) pgrep -f "openclaw.*--config $HOME/.${t}" >/dev/null 2>&1 && PR=1 ;;
    hermes)
      for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
        [ -n "$hp" ] || continue
        HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
        [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
        if [ -z "$HME" ] || [ "$HME" = "$HOME/.hermes" ] || [ "$HME" = ".hermes" ]; then PR=1; break; fi
      done
      if [ "$PR" = 0 ]; then
        command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && PR=1
      fi
      ;;
  esac
fi
# Hermes self-reports its own lifecycle via control socket — catches gateways
# the (possibly stale) pidfile/systemd cannot see. Run through the venv so
# hermes_cli imports resolve (bare /usr/local/lib/hermes-agent/hermes fails
# on system python without venv site-packages).
if [ "$PR" = 0 ] && [ "${t}" = "hermes" ]; then
  export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
  HB=$(command -v hermes 2>/dev/null)
  [ -n "$HB" ] && { HERMES_HOME="$HOME/.hermes" timeout 12 "$HB" gatew""ay status 2>/dev/null | grep -q 'is running' && PR=1; }
fi
echo "PROC=$PR"
for d in "$HOME"/.${t}-*; do
  [ -d "$d" ] || continue
  tname="$(basename "$d")"
  tag="\${tname#.${t}-}"
  case "$tag" in docker|bak|*.bak|*.old|tmp|*.env.bak|*.config.yaml.bak) continue ;; esac
  VALID=0
  if [ -f "$d/config.yaml" ] || [ -f "$d/config.json" ] || [ -f "$d/config.toml" ] || [ -f "$d/.env" ] || [ -f "$d/instance.env" ] || [ -d "$d/hermes-agent" ] || [ -f "$d/daemon.pid" ] || [ -f "$d/gateway.pid" ]; then
    VALID=1
  fi
  RUN=0
  [ -f "$d/daemon.pid" ] && kill -0 "$(cat "$d/daemon.pid")" 2>/dev/null && RUN=1
  [ -f "$d/gateway.pid" ] && kill -0 "$(cat "$d/gateway.pid")" 2>/dev/null && RUN=1
  if [ "$RUN" = 0 ]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
    { systemctl --user is-active "${t}-gatew""ay@\${tag}" 2>/dev/null || systemctl --user is-active "${t}@\${tag}" 2>/dev/null || systemctl is-active "${t}-gatew""ay@\${tag}" 2>/dev/null; } | grep -qx active && RUN=1
    # process-cmdline fallback: catches gateways started without a pidfile
    if [ "$RUN" = 0 ]; then
      case "${t}" in
        nanobot)
          for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
            [ -r "/proc/$p/cmdline" ] || continue
            C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
            [ -n "$C" ] || continue
            case "$C" in *NBLISTSCAN*) continue;; esac
            case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
            HME=$(echo "$C" | grep -o '\\.${t}[-a-zA-Z0-9_]*' | head -1)
            if [ "$HME" = ".\${tname}" ]; then RUN=1; break; fi
          done
          ;;
        zeroclaw) pgrep -f "zeroclaw.*--config-dir $d" >/dev/null 2>&1 && RUN=1 ;;
        openclaw) pgrep -f "openclaw.*--config $d" >/dev/null 2>&1 && RUN=1 ;;
        hermes)
          for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
            [ -n "$hp" ] || continue
            HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
            [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
            case "$HME" in *".\${tname}"|*".\${tname}/") RUN=1; break ;; esac
          done
          ;;
      esac
    fi
    # Hermes fallback: control-socket self-report (stale-pidfile proof)
    if [ "$RUN" = 0 ] && [ "${t}" = "hermes" ]; then
      export PATH="$d/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
      HB=$(command -v hermes 2>/dev/null)
      [ -n "$HB" ] && { HERMES_HOME="$d" timeout 8 "$HB" gatew""ay status 2>/dev/null | grep -q 'is running' && RUN=1; }
    fi
  fi
  if [ "$RUN" = 1 ] || [ "$VALID" = 1 ]; then
    echo "TAGRUN=\${tag}:$RUN"
  fi
done
`,{timeoutMs:6e4})).stdout||"",o=[];for(let e of(/DEFAULT_EXISTS=1/.test(n)&&o.push({tag:"",running:/PROC=1/.test(n)}),n.matchAll(/TAGRUN=([^:\n]+):(\d)/g)))o.push({tag:e[1],running:"1"===e[2]});return o}async function l(e,t,n,o=[]){if(0===o.length)return{existed:!1,ok:!1};let a=o.filter(e=>".env"!==e.split("/").pop()).map(e=>{let r=e.includes("/")?`mkdir -p "$HOME/.${t}-${n}/${e.slice(0,e.lastIndexOf("/"))}"
  `:"";return`${r}[ -f "$HOME/.${t}/${e}" ] && cp "$HOME/.${t}/${e}" "$HOME/.${t}-${n}/${e}"`}).join("\n"),s=`
if [ -d "$HOME/.${t}-${n}" ]; then echo "EXISTS"; exit 0; fi
mkdir -p "$HOME/.${t}-${n}"
${a}
mkdir -p "$HOME/.${t}-${n}/logs"
# Fresh empty .env — the instance is fully credential-isolated from the start.
: > "$HOME/.${t}-${n}/.env"
echo CLONED
`,i=await (0,r.execCommand)(e,s,{pool:!1,timeoutMs:3e4});return{existed:/EXISTS/.test(i.stdout||""),ok:/CLONED|EXISTS/.test(i.stdout||""),tokenSame:!1}}async function c(e,t,n,o){if(!n)return{copied:!1,bin:"",err:"no tag"};let a={hermes:{dstRoot:"hermes-agent",src:"",bin:"hermes-agent/venv/bin/hermes",py:"venv/bin/python",fullCopy:!0},nanobot:{dstRoot:"venv",src:"$HOME/.nanobot/venv",bin:"venv/bin/nanobot",py:"venv/bin/python"},openclaw:{dstRoot:"install",src:"$HOME/.openclaw/local",bin:"install/bin/openclaw",py:null}}[t];if(!a)return{copied:!1,bin:"",err:`unsupported ${t}`};let s=`${o}/${a.dstRoot}`,i=a.py?a.py.replace(/\/[^/]*$/,""):"",l=a.py?`
# Rewrite bin/* shebangs to the instance-local interpreter so the copied venv
# is self-contained (default rm -rf cannot break it).
NEWPY="${s}/${a.py}"
BINDIR="${s}/${i}"
for f in "\${BINDIR}/"*; do
  [ -f "$f" ] || continue
  head1=$(head -1 "$f" 2>/dev/null)
  case "$head1" in
    '#!'*) case "$head1" in *"python"*) printf '#!%s\\n' "$NEWPY" > "$f.tmp"; tail -n +2 "$f" >> "$f.tmp"; mv -f "$f.tmp" "$f"; chmod 755 "$f";; esac ;;
  esac
done
# pyvenv.cfg home points at the system python — still valid after the copy.
# Editable installs (pip install -e) embed the ORIGINAL tree path in .pth /
# finder files — repoint them at this copy so the venv is fully self-contained.
SP=$(ls -d ${s}/venv/lib/python*/site-packages 2>/dev/null | head -1)
if [ -n "$SP" ] && [ "$SRC" != "$dst" ]; then
  grep -rlF "$SRC" "$SP" 2>/dev/null | while read -r pf; do
    sed -i "s|$SRC|${s}|g" "$pf" 2>/dev/null
  done
fi
`:"",c=a.fullCopy?`
# Hermes installs may be user-local or root-wide. Select the default runtime
# without falling back to a shared live path at execution time.
SRC=""
for candidate in "$HOME/.hermes/hermes-agent" "/usr/local/lib/hermes-agent" "/opt/hermes-agent"; do
  if [ -d "$candidate" ]; then SRC="$candidate"; break; fi
done
[ -n "$SRC" ] || { echo NO_SRC; exit 0; }
# cp -a is intentional for Hermes: no hard-linked code, venv, plugins or
# package metadata is shared with the default instance.
cp -a "$SRC" "${s}" 2>/dev/null || { echo COPY_FAIL; exit 0; }
echo COPY_FULL
`:`
SRC="${a.src}"
[ -e "$SRC" ] || { echo NO_SRC; exit 0; }
if cp -al "$SRC" "${s}" 2>/dev/null; then
  echo COPY_LINKED
elif cp -a "$SRC" "${s}" 2>/dev/null; then
  echo COPY_FULL
else
  echo COPY_FAIL
  exit 0
fi
`,d=`
[ -d "${s}" ] && echo ALREADY && exit 0
mkdir -p "${o}"
${c}
rm -f "${s}/daemon.pid" 2>/dev/null
# Strip copied bytecode: stale .pyc files can fail after a Python/runtime change.
find "${s}" -depth -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
find "${s}" -name '*.pyc' -delete 2>/dev/null
${l}
`,u=(await (0,r.execCommand)(e,d,{pool:!1,timeoutMs:18e4})).stdout||"",$=/COPY_LINKED|COPY_FULL|ALREADY/.test(u)?`${o}/${a.bin}`:"";return{copied:/COPY_LINKED|COPY_FULL/.test(u),linked:/COPY_LINKED/.test(u),already:/ALREADY/.test(u),bin:$,err:/NO_SRC/.test(u)?"bin source not found":/COPY_FAIL/.test(u)?"copy failed":""}}function d(e){return String(e||"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,31).replace(/^[^a-z_]+/,"")}async function u(e,t,n={}){let o=await (0,r.execCommand)(e,function(e,{publicKey:t=""}={}){let n=d(e),r=Buffer.from(String(t||""),"utf8").toString("base64");return`
U="${n}"
case "$U" in ''|root|daemon|bin|sys|sync|games|man|lp|mail|news|uucp|proxy|www-data|backup|list|irc|gnats|nobody|systemd-*|sshd|messagebus) echo "BAD_USER=$U"; exit 0;; esac
S=""
command -v useradd >/dev/null 2>&1 && S="" || S="sudo -n"
if ! id "$U" >/dev/null 2>&1; then
  $S useradd -m -s /bin/bash "$U" 2>/dev/null || useradd -m -s /bin/bash "$U" 2>/dev/null || { echo "CREATE_FAILED"; exit 0; }
fi
export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
loginctl enable-linger "$U" 2>/dev/null || $S loginctl enable-linger "$U" 2>/dev/null || true
HOME_U="$(getent passwd "$U" | cut -d: -f6)"
chmod 700 "$HOME_U" 2>/dev/null || true
if [ -n "${r}" ]; then
  mkdir -p "$HOME_U/.ssh" && chmod 700 "$HOME_U/.ssh"
  echo "${r}" | base64 -d > "$HOME_U/.ssh/authorized_keys"
  chmod 600 "$HOME_U/.ssh/authorized_keys"
  chown -R "$U:$U" "$HOME_U/.ssh" 2>/dev/null || true
  echo "PUBKEY=1"
fi
echo "USER=$U"
echo "HOME_U=$HOME_U"
echo "UID_U=$(id -u "$U")"
echo "PROVISIONED"
`}(t,n),{pool:!1,timeoutMs:3e4}),a=o.stdout||"",s=e=>a.match(RegExp(`${e}=(.*)`))?.[1]?.trim()||null,i=/PROVISIONED/.test(a);return{ok:i,existed:!(!i||/PUBKEY|CREATE_FAILED/.test(a))||void 0,username:s("USER"),home:s("HOME_U"),uid:s("UID_U"),error:/BAD_USER/.test(a)?"Reserved or invalid username":/CREATE_FAILED/.test(a)?"useradd failed (need root/sudo)":i?null:(o.stderr||"").slice(-200)||"provision failed"}}async function $(e,t,n){let o=`
UNIT="$HOME/.config/systemd/user/${t}-gatew""ay@.service"
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<'UNIT_EOF'
${n}
UNIT_EOF
export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
systemctl --user daemon-reload 2>/dev/null || true
echo UNIT_OK
`,a=await (0,r.execCommand)(e,o,{pool:!1,timeoutMs:2e4});return{ok:/UNIT_OK/.test(a.stdout||"")}}async function p(e,t,n={},{expand:o=!1}={}){let a=Object.entries(n).filter(([e,t])=>/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(String(e))&&null!=t&&""!==t).map(([e,t])=>`${e}=${String(t).replace(/[\r\n]+/g," ").replace(/`/g,"")}`);if(0===a.length)return{ok:!0,skipped:!0};let s=`mkdir -p "${t}"
cat > "${t}/instance.env" <<${o?"ENV_EOF":"'ENV_EOF'"}
${a.join("\n")}
ENV_EOF
echo ENV_OK`,i=await (0,r.execCommand)(e,s,{pool:!1,timeoutMs:15e3});return{ok:/ENV_OK/.test(i.stdout||"")}}async function h(e){let t=await (0,r.execCommand)(e,'export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; systemctl --user show-environment >/dev/null 2>&1 && echo SD_OK || echo SD_NO',{pool:!1,timeoutMs:15e3});return/SD_OK/.test(t.stdout||"")}async function m(e,t,n,o){let a=`${t}-gatew""ay@${n}`,s='export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null;';if("status"===o){let t=await (0,r.execCommand)(e,`${s} systemctl --user is-active ${a} 2>/dev/null | grep -qx active && echo ACTIVE || echo INACTIVE`,{pool:!1,timeoutMs:2e4});return{ok:!0,active:/ACTIVE/.test(t.stdout||""),via:"systemd"}}if("stop"===o){let o=await (0,r.execCommand)(e,`${s} systemctl --user disable --now ${a} 2>/dev/null; systemctl --user stop ${a} 2>/dev/null; systemctl --user reset-failed ${a} 2>/dev/null; rm -f "$HOME/.config/systemd/user/default.target.wants/${t}-gatew""ay@${n}.service" "$HOME/.config/systemd/user/multi-user.target.wants/${t}-gatew""ay@${n}.service" 2>/dev/null; systemctl --user daemon-reload 2>/dev/null || true; echo SD_STOPPED`,{pool:!1,timeoutMs:45e3});return{ok:/SD_STOPPED/.test(o.stdout||""),out:((o.stdout||"")+(o.stderr||"")).slice(-300),via:"systemd"}}"restart"===o&&await m(e,t,n,"stop");let i=await (0,r.execCommand)(e,`${s} loginctl enable-linger $(whoami) 2>/dev/null || sudo -n loginctl enable-linger $(whoami) 2>/dev/null || true; systemctl --user daemon-reload 2>/dev/null || true; systemctl --user enable --now ${a} 2>/dev/null; sleep 2; systemctl --user is-active ${a} 2>/dev/null | grep -qx active && echo SD_UP || echo SD_DOWN`,{pool:!1,timeoutMs:6e4});return/SD_UP/.test(i.stdout||"")?{ok:!0,via:"systemd",out:"GW_UP (systemd)"}:null}[r]=o.then?(await o)():o,e.s(["cloneDefaultHome",0,l,"copyInstanceBin",0,c,"ensureInstanceUnit",0,$,"gatewayUnit",0,function(e,{description:t,envLines:n=[],execStart:r,logFile:o,memoryMax:a="2G",cpuQuota:s="200%"}){let i=["[Unit]",`Description=${t} (instance %i)`,"After=network-online.target","","[Service]","Type=simple",...n,`ExecStartPre=/bin/mkdir -p %h/.${e}-%i/logs`,r,"Restart=on-failure","RestartSec=3","SuccessExitStatus=0 143","NoNewPrivileges=true","PrivateTmp=true",`StandardOutput=append:${o}`,`StandardError=append:${o}`];return a&&"none"!==a&&i.push(`MemoryMax=${a}`),s&&"none"!==s&&i.push(`CPUQuota=${s}`),i.push("","[Install]","WantedBy=default.target"),i.join("\n")},"homeDir",0,function(e,t){return t?`$HOME/.${e}-${t}`:`$HOME/.${e}`},"instanceIsolationEnv",0,function(e,t,n){if(!t)return{};let r=String(t).toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,64)||"default",[o,a]=s(e,t,["api","hook"]);if("hermes"!==e)return{[`${String(e).toUpperCase()}_HOME`]:n};let i={HERMES_HOME:n,HERMES_KANBAN_HOME:`${n}/kanban`,HERMES_KANBAN_DB:`${n}/kanban/kanban.db`,HERMES_KANBAN_WORKSPACES_ROOT:`${n}/kanban/workspaces`,HERMES_KANBAN_BOARD:r,TERMINAL_SANDBOX_DIR:`${n}/sandboxes`,HERMES_OAUTH_FILE:`${n}/auth.json`,CODEX_HOME:`${n}/codex`,HERMES_WRITE_SAFE_ROOT:[n,`${n}/sandboxes`,`${n}/workspace`].join(":")};return o&&(i.API_SERVER_PORT=String(o)),a&&(i.WEBHOOK_PORT=String(a)),i},"instancePort",0,a,"instancePorts",0,s,"listInstances",0,i,"parseInst",0,function(e={}){let t=e?.instance??e?.config?.instance??e?.config?.tag??"";return String(t).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,24)},"provisionUser",0,u,"sanitizeUsername",0,d,"sdAvailable",0,h,"sdInstanceCtl",0,m,"writeInstanceEnv",0,p]),n()}catch(e){n(e)}},!1),47185,e=>e.a(async(t,n)=>{try{var r=e.i(29072),o=e.i(46589),a=e.i(54981),s=e.i(73757),i=e.i(51631),l=e.i(37034),c=t([o]);async function d(t,n={}){let r,o={...t};if(r=o.host,/^(localhost|127\.0\.0\.1)$/.test(r)||"local"===n.sshMode){let t,r=function(){let t=e.g.__activeRelays;if(!t||0===t.size)return null;let n=t.values().next().value;return n instanceof Map&&n.size>0?n.values().next().value:!n||n instanceof Map?null:n}();if(!r||!r.ws)throw Error("Local Relay Agent is not connected. Please start local-relay.js on your target machine.");let a=o.host&&(t=o.host,!/^(localhost|127\.0\.0\.1)$/.test(t))?o.host:"localhost",s=parseInt(o.port,10)||22;if("function"==typeof e.g.__requestRelayForwarder)try{let t=await e.g.__requestRelayForwarder(n.userId||null,n.preferredRelay||null,a,s);return o.host="127.0.0.1",o.port=t.port,delete o.sock,o}catch(e){i.logger.warn("[ssh] forwarder request failed, using shared-target mode:",e.message)}r.targetHost=a,r.targetPort=s,o.host="127.0.0.1",o.port=r.localPort,delete o.sock}return o}async function u(t,n={}){let r=await (0,o.default)(),i=new a.ConnectionRepository(r,n.userId||null),l=n.userId||null,c=null;if(!l&&!n.skipSessionResolve)try{let{getServerSession:t}=await e.A(75248),{authOptions:n}=await e.A(42035),r=await t(n);l=r?.user?.id||null,c=r?.user?.role||null}catch(e){}await i.init();let $=await i.findById(t);if(!$)throw Error("Connection not found");if($.userId&&String($.userId)!==String(l||"")&&"admin"!==c)throw Error("Access denied: this connection belongs to another user");let p={host:$.host,port:$.port||22,username:$.username||"root",readyTimeout:2e4,keepaliveInterval:1e4,keepaliveCountMax:12};if("password"===$.authType&&$.password){let e=(0,s.decrypt)($.password);if(e&&e.includes(":")&&e.length>40){let t=(0,s.decrypt)(e);t&&!t.includes(":")&&(e=t)}p.password=e}else if("privateKey"===$.authType&&$.privateKey){let e=(0,s.decrypt)($.privateKey);if(e&&e.includes(":")&&e.length>40){let t=(0,s.decrypt)(e);t&&!t.includes(":")&&(e=t)}if(p.privateKey=e,$.passphrase){let e=(0,s.decrypt)($.passphrase);if(e&&e.includes(":")&&e.length>40){let t=(0,s.decrypt)(e);t&&!t.includes(":")&&(e=t)}p.passphrase=e}}return d(p,{sshMode:$.sshMode||n.sshMode,preferredRelay:$.preferredRelay||n.preferredRelay,userId:l,...n})}function $(e){return`${e.username||"root"}@${e.host||"127.0.0.1"}:${e.port||22}`}function p(e,t,n,r){return n.timeoutMs?setTimeout(()=>{try{e.signal("KILL")}catch{}try{e.close()}catch{}try{t.end()}catch{}r()},n.timeoutMs):null}[o]=c.then?(await c)():c,e.g.__sshConnectionPool=e.g.__sshConnectionPool||new Map,e.s(["execCommand",0,function t(n,o,a={}){let s=Array.isArray(o)?o.join("\n"):String(o??"");return new Promise(!1!==a.pool?(o,i)=>{(function(t){let n=e.g.__sshConnectionPool,o=$(t),a=n.get(o);if(a&&a.ready&&a.client&&a.client._sock&&!a.client._sock.destroyed)return a.idleTimeout&&clearTimeout(a.idleTimeout),a.idleTimeout=setTimeout(()=>{try{a.client.end()}catch{}n.delete(o)},3e4),Promise.resolve(a.client);if(a){try{a.client.end()}catch{}n.delete(o)}return new Promise((e,a)=>{let s=new r.Client,i=!1,l={client:s,ready:!1,idleTimeout:null},c=()=>{l.idleTimeout&&clearTimeout(l.idleTimeout),n.delete(o);try{s.end()}catch{}};s.on("ready",()=>{l.ready=!0,l.idleTimeout=setTimeout(()=>{c()},3e4),n.set(o,l),i||(i=!0,e(s))}),s.on("error",e=>{c(),i||(i=!0,a(e))}),s.on("close",()=>{c()}),s.on("end",()=>{c()}),s.connect(t)})})(n).then(r=>{let l="",c="";r.exec(s,(d,u)=>{if(d){let l=e.g.__sshConnectionPool,c=$(n);l.delete(c);try{r.end()}catch{}return t(n,s,{...a,pool:!1}).then(o).catch(i)}u.on("data",e=>{let t=e.toString();l+=t,a.onStdout?.(t)});let h=!1,m=p(u,r,a,()=>{h=!0});u.stderr.on("data",e=>{let t=e.toString();c+=t,a.onStderr?.(t)}),u.on("close",e=>{if(m&&clearTimeout(m),h)return i(Error(`Command timed out after ${Math.round(a.timeoutMs/1e3)}s`));let t="number"==typeof e?e:c.trim()&&!l.trim()?1:0;o({code:t,stdout:l,stderr:c})})})}).catch(e=>{t(n,s,{...a,pool:!1}).then(o).catch(i)})}:(e,t)=>{let o=new r.Client,i="",l="";o.on("ready",()=>{o.exec(s,(n,r)=>{if(n)return o.end(),t(n);let s=!1,c=p(r,o,a,()=>{s=!0});r.on("data",e=>{let t=e.toString();i+=t,a.onStdout?.(t)}),r.stderr.on("data",e=>{let t=e.toString();l+=t,a.onStderr?.(t)}),r.on("close",n=>{if(c&&clearTimeout(c),o.end(),s)return t(Error(`Command timed out after ${Math.round(a.timeoutMs/1e3)}s`));let r="number"==typeof n?n:l.trim()&&!i.trim()?1:0;e({code:r,stdout:i,stderr:l})})})}),o.on("error",t),o.connect(n)})},"getSshConfig",0,u,"sftpReadStream",0,function(e,t){return new Promise((n,o)=>{let a=new r.Client;a.on("ready",()=>{a.exec(`cat ${(0,l.shellQuote)(t)}`,(e,r)=>{if(e)return a.sftp((e,r)=>{if(e)return a.end(),o(e);let s=r.createReadStream(t);s.on("close",()=>a.end()),s.on("error",e=>{a.end(),o(e)}),n(s)});r.stderr?.on("data",()=>{}),r.on("close",()=>a.end()),r.on("error",e=>{a.end(),o(e)}),n(r)})}),a.on("error",o),a.connect(e)})},"sftpTransfer",0,function(t,n,o,a,{onProgress:s,signal:i}={}){return new Promise(async(c,d)=>{let u=new r.Client,$=new r.Client,p=!1,h=!1,m=()=>{try{u.end()}catch{}try{$.end()}catch{}};i&&i.addEventListener("abort",()=>{p=!0,m(),d(Error("Transfer cancelled by user"))});let f=e=>{h||p||(h=!0,m(),d(e instanceof Error?e:Error(String(e))))};u.on("error",f),$.on("error",f);let g=Promise.all([new Promise((e,n)=>{u.on("ready",e),u.on("error",n),u.connect(t)}),new Promise((e,t)=>{$.on("ready",e),$.on("error",t),$.connect(o)})]);try{if(await g,p)return;let t=await new Promise(e=>{u.exec(`[ -d ${(0,l.shellQuote)(n)} ] && echo DIR || echo FILE`,(t,n)=>{if(t)return e(!1);let r="";n.on("data",e=>r+=e.toString()),n.stderr?.on("data",()=>{}),n.on("close",()=>e("DIR"===r.trim()))})}),r=await new Promise(e=>{let r=(0,l.shellQuote)(n),o=t?`du -sb ${r} 2>/dev/null | cut -f1`:`stat -c%s ${r} 2>/dev/null || wc -c < ${r} 2>/dev/null || echo 0`,a=setTimeout(()=>e(0),5e3);try{u.exec(o,(t,n)=>{if(t)return clearTimeout(a),e(0);let r="";n.on("data",e=>r+=e.toString()),n.stderr?.on("data",()=>{}),n.on("close",()=>{clearTimeout(a);let t=parseInt(r.trim(),10);e(!isNaN(t)&&t>0?t:0)}),n.on("error",()=>{clearTimeout(a),e(0)})})}catch{clearTimeout(a),e(0)}});s&&s({transferred:0,totalSize:r,percent:0});let o=0,i=0,y=(e,t=!1)=>{let n=Date.now(),o=t?100:r>0?Math.min(99,Math.round(e/r*100)):50;(t||n-i>250)&&(i=n,s&&s({transferred:e,totalSize:r,percent:o}))},v=e.r(14747).posix.dirname(a),E=(0,l.shellQuote)(n),w=(0,l.shellQuote)(a),_=(0,l.shellQuote)(v),R=t?`tar cf - -C ${E} . 2>/dev/null`:`cat ${E}`,S=t?`rm -rf ${w} && mkdir -p ${w} && tar xf - -C ${w} 2>/dev/null`:`mkdir -p ${_} && cat > ${w}`;u.exec(R,(e,t)=>{if(e)return f(e);$.exec(S,(e,n)=>{if(e)return t.destroy(),f(e);t.stderr?.on("data",()=>{}),n.stderr?.on("data",()=>{}),t.pipe(n),y(0),t.on("data",e=>{o+=e.length,y(o)});let a=null,s=(e,s)=>{if(!h&&!p){h=!0,a&&clearTimeout(a);try{t.destroy()}catch{}try{n.destroy()}catch{}m(),e?(y(r>0?r:o,!0),c({transferred:r>0?r:o,totalSize:r})):d(Error(s||"Direct transfer failed"))}};t.on("end",()=>{try{n.end()}catch{}a||(a=setTimeout(()=>{s(!0)},4e3))}),t.on("exit",e=>{null!=e&&e>1&&s(!1,`Source stream exited with code ${e}`)}),n.on("exit",e=>{null==e||e<=1?s(!0):s(!1,`Target stream exited with code ${e}`)}),n.on("close",()=>s(!0)),t.on("error",e=>s(!1,e?.message)),n.on("error",e=>s(!1,e?.message))})})}catch(e){f(e)}})},"sftpUpload",0,function(t,n,o,{onProgress:a}={}){return new Promise((s,i)=>{let l=e.r(22734),c=0;try{c=l.statSync(n).size}catch{}let d=new r.Client;d.on("ready",()=>{d.sftp((e,t)=>{if(e)return d.end(),i(e);let r=l.createReadStream(n),u=t.createWriteStream(o),$=-1,p=()=>{let e=Number.isFinite(u.bytesWritten)?u.bytesWritten:r.bytesRead||0;(e!==$||e===c)&&($=e,a?.(e,c))};u.on("drain",p),r.on("data",()=>{Number.isFinite(u.bytesWritten)||p()}),r.pipe(u),u.on("close",()=>{a?.(c,c),d.end(),s()}),u.on("error",e=>{d.end(),i(e)}),r.on("error",e=>{d.end(),i(e)})})}),d.on("error",i),d.connect(t)})}]),n()}catch(e){n(e)}},!1),37034,e=>{"use strict";function t(e){return`'${String(e).replace(/'/g,"'\\''")}'`}e.s(["shellInt",0,function(e){let t=parseInt(e,10);return isNaN(t)||t<0?null:String(t)},"shellQuote",0,t,"shellQuoteExpandHome",0,function(e){let n=String(e),r=n.startsWith("$HOME/")?"$HOME/":n.startsWith("~/")?"~/":"",o=r?n.slice("$HOME/"===r?6:2):n;return r?`${r}${t(o)}`:t(n)}])}];

//# sourceMappingURL=src_1ynl27t._.js.map