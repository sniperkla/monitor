module.exports=[99747,e=>e.a(async(t,s)=>{try{var n=e.i(89171),r=e.i(23667),a=e.i(80533),o=e.i(47185),i=e.i(43185),l=e.i(67723),c=e.i(69683),u=e.i(51631),d=e.i(37034),m=t([a,o,l,c]);[a,o,l,c]=m.then?(await m)():m;let E=d.shellQuote,b="https://hermes-agent.nousresearch.com/install.sh";function p(e){let t=Buffer.from(e.map(([e,t])=>`${e}=${t}`).join("\n"),"utf8").toString("base64");return`import os, base64
lines_raw = base64.b64decode('${t}').decode('utf-8').splitlines()
ep = (os.environ.get('HERMES_HOME') or os.path.expanduser('~/.hermes')) + '/.env'
os.makedirs(os.path.dirname(ep), exist_ok=True)
existing = open(ep).read().splitlines() if os.path.exists(ep) else []
upsert = {}
for ln in lines_raw:
    idx = ln.find('=')
    if idx > 0: upsert[ln[:idx]] = ln[idx+1:]
result = [ln for ln in existing if ln.find('=') <= 0 or ln[:ln.find('=')] not in upsert]
written = set()
for ln in existing:
    idx = ln.find('=')
    if idx > 0 and ln[:idx] in upsert and ln[:idx] not in written:
        result.append(ln[:idx] + '=' + upsert[ln[:idx]])
        written.add(ln[:idx])
for k, v in upsert.items():
    if k not in written:
        result.append(k + '=' + v)
        written.add(k)
open(ep, 'w').write('\\n'.join(result) + '\\n')
os.chmod(ep, 0o600)
print('ENV_UPDATED')`}function h(e){return"model"===e?"model.default":e}function $(e){let t=(Array.isArray(e)?e:Object.entries(e||{})).filter(([e,t])=>null!=e&&""!==String(e).trim()&&null!=t&&""!==String(t).trim()),s=Buffer.from(JSON.stringify(t.map(([e,t])=>[h(String(e).trim()),t])),"utf8").toString("base64");return`import json, os, base64, re
new = json.loads(base64.b64decode('${s}').decode('utf-8'))
path = (os.environ.get('HERMES_HOME') or os.path.expanduser('~/.hermes')) + '/config.yaml'
os.makedirs(os.path.dirname(path), exist_ok=True)
lines = open(path).read().splitlines() if os.path.exists(path) else []
def _ind(l): return len(l) - len(l.lstrip(' '))
def _blank(l): return l.strip() == ''
def _fmt(v):
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    s = str(v)
    if s == '': return '""'
    low = s.lower()
    if low == 'true': return 'true'
    if low == 'false': return 'false'
    if re.match(r'^[A-Za-z0-9_][A-Za-z0-9_./-]*$', s) and low not in ('null', 'yes', 'no', 'on', 'off', '~'):
        return s
    return json.dumps(s, ensure_ascii=False)
def _end(i, base):
    j = i + 1
    while j < len(lines):
        if _blank(lines[j]):
            k = j
            while k < len(lines) and _blank(lines[k]): k += 1
            if k < len(lines) and _ind(lines[k]) > base:
                j = k; continue
            break
        if _ind(lines[j]) <= base: break
        j += 1
    return j
def _set(parts, val, ind, start, end):
    key = parts[0]
    pat = re.compile(r'^([A-Za-z0-9_.\\-]+)\\s*:\\s*(.*)$')
    i = None
    for j in range(start, end):
        l = lines[j]
        if _blank(l) or _ind(l) != ind: continue
        m = pat.match(l)
        if m and m.group(1) == key:
            i = j; break
    if i is None:
        while end > start and _blank(lines[end-1]): end -= 1
        if len(parts) == 1:
            lines.insert(end, ' ' * ind + key + ': ' + _fmt(val))
        else:
            lines.insert(end, ' ' * ind + key + ':')
            for d in range(1, len(parts)):
                lines.insert(end + d, ' ' * (ind + 2*d) + parts[d] + (': ' + _fmt(val) if d == len(parts)-1 else ':'))
        return
    e = _end(i, ind)
    if len(parts) == 1:
        lines[i:e] = [' ' * ind + key + ': ' + _fmt(val)]
        return
    m = pat.match(lines[i])
    if m and m.group(2).strip() != '':
        lines[i] = ' ' * ind + key + ':'
    _set(parts[1:], val, ind + 2, i + 1, e)
for k, v in new:
    _set(str(k).split('.'), v, 0, 0, len(lines))
open(path, 'w').write('\\n'.join(lines) + ('\\n' if lines else ''))
os.chmod(path, 0o600)
print('SETTINGS_MERGED')`}let y=Object.freeze({openrouter:"OPENROUTER_API_KEY",openai:"OPENAI_API_KEY",anthropic:"ANTHROPIC_API_KEY"});function g(e){let t=String(e?.id||"").trim().toLowerCase();if(y[t])return y[t];if("custom"===t){let t=String(e?.envKey||"").trim();return/^[A-Z][A-Z0-9_]*$/.test(t)?t:""}return""}let w=(e="")=>`PROC=0
for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
  [ -n "$hp" ] || continue
  HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
  [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
  # A process carrying NO home marker cannot be attributed to this instance.
  # For the default install we keep the legacy lenient behaviour (an
  # unattributed gateway is assumed to be the default's). For a TAGGED instance
  # it must be ignored: it belongs to a sibling or the default, and counting it
  # would make every instance report itself as running whenever any other
  # hermes gateway on the box is up — the core cross-instance leak.
  if [ -z "$HME" ]; then ${e?"continue":"PROC=1; break"}; fi
  case "$HME" in *".hermes${e?"-"+e:""}") PROC=1; break ;; esac
done`,R=(e="")=>`
${e?`export HERMES_HOME="$HOME/.hermes-${e}"`:""}
HH="\${HERMES_HOME:-$HOME/.hermes}"
# Instance-scoped PATH: a tagged instance must resolve "hermes" from its OWN
# copied runtime tree. The DEFAULT home's venv is deliberately kept off a
# tagged instance's PATH — otherwise every spawned instance would execute the
# default install's code and all of them would share a single runtime.
if [ -n "${e}" ]; then
  export PATH="\${HH}/hermes-agent/venv/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
else
  export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
fi
BIN="$(command -v hermes 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "\${HH}/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/hermes" "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CODE=0; [ -d "$HH/hermes-agent" ] && CODE=1
echo "CODE=$CODE"
CFG=0; [ -f "$HH/config.yaml" ] && CFG=1
echo "CONFIG=$CFG"
ENVF=0; [ -f "$HH/.env" ] && ENVF=1
echo "ENVFILE=$ENVF"
DIR=0; [ -d "$HH" ] && DIR=1
echo "DIR=$DIR"
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
${w(e)}
GSTAT=0; if [ "$PROC" = 0 ] && [ -n "$BIN" ]; then timeout 15 "$BIN" gatew""ay status 2>/dev/null | grep -q 'is running' && GSTAT=1; fi
[ "$GSTAT" = 1 ] && PROC=1
echo "PROC=$PROC"
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
GIT=$(git --version 2>/dev/null | awk '{print $3}')
[ -z "$GIT" ] && GIT=NONE
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
XZ=0; command -v xz >/dev/null 2>&1 && XZ=1
ATOMIC=0
{ ldconfig -p 2>/dev/null | grep -q libatomic || [ -e /usr/lib64/libatomic.so.1 ] || [ -e /usr/lib/x86_64-linux-gnu/libatomic.so.1 ]; } && ATOMIC=1
CXX=0; { command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1; } && CXX=1
TARP=0; command -v tar >/dev/null 2>&1 && TARP=1
PROCP=0; command -v pgrep >/dev/null 2>&1 && PROCP=1
echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"
echo "GIT=$GIT"; echo "CURL=$CURLP"; echo "XZ=$XZ"; echo "ATOMIC=$ATOMIC"; echo "CXX=$CXX"; echo "TAR=$TARP"; echo "PROCP=$PROCP"
DOCKER=0; command -v docker >/dev/null 2>&1 && DOCKER=1
DCONT=0; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && DCONT=1
echo "DOCKER=$DOCKER"; echo "DCONT=$DCONT"
if [ "$DCONT" = "1" ]; then
  CV="$(docker exec hermes-agent hermes --version 2>/dev/null | tail -1 | cut -c1-40)"
  [ -n "$CV" ] && echo "CVERSION=$CV"
  docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && CGW=1 || CGW=0
  echo "CGW=$CGW"
fi
`;async function f(e){try{let t=await (0,r.getServerSession)(a.authOptions);if(!t)return n.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let s=await e.json(),{connectionId:o,action:l,config:c={},purge:u=!1}=s;if(!o||!l)return n.NextResponse.json({success:!1,error:"Missing connectionId or action"},{status:400});if("job"===l)return(0,i.dispatchWithLiveLogs)(s,()=>({}));return(0,i.dispatchWithLiveLogs)(s,(e,s)=>v(e,t,s))}catch(e){return u.logger.error("[agents/hermes] POST failed:",e?.message),n.NextResponse.json({success:!1,error:e?.message||"Request failed"},{status:500})}}async function v(e,t,s=[]){try{let{connectionId:t,action:r,config:a={},purge:i=!1}=e,u=await (0,o.getSshConfig)(t),d=(0,l.parseInst)(e),m=d?`$HOME/.hermes-${d}`:"$HOME/.hermes",f=d?`export HERMES_HOME=$HOME/.hermes-${d};`:"",[v,y]=(0,l.instancePorts)("hermes",d),O=(0,l.instanceIsolationEnv)("hermes",d,m),S=async e=>{if(!d)return{ok:!0,skipped:!0};let t=await (0,l.writeInstanceEnv)(u,m,O,{expand:!0});return t.ok||s.push(`> [isolation] WARNING: could not write ${m}/instance.env (${e}) — this instance may share state with siblings.`),t},M=`res=0; pid=$(cat "${m}/daemon.pid" 2>/dev/null); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= 2>/dev/null | grep -qF ".hermes${d?`-${d}`:""}"; then res=1; fi; if [ "$res" = 0 ] && [ -z "${d}" ]; then systemctl --user is-active hermes-gate\\way 2>/dev/null | grep -qx active && res=1; systemctl is-active hermes-gate\\way 2>/dev/null | grep -qx active && res=1; fi; if [ "$res" = 0 ] && [ -n "${d}" ]; then export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; systemctl --user is-active hermes-gate""way@${d} 2>/dev/null | grep -qx active && res=1; fi; if [ "$res" = 0 ]; then export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; ${d?`export HERMES_HOME=$HOME/.hermes-${d};`:""} timeout 15 hermes gatew""ay status 2>/dev/null | grep -q 'is running' && res=1; fi; echo "PID_ALIVE=$res"`,k=async()=>{let e=await (0,o.execCommand)(u,M,{pool:!1,timeoutMs:15e3});return/PID_ALIVE=1/.test(e.stdout||"")},x=null,C=async(e,t,n={})=>{let r=x?x(t):t,a=await (0,o.execCommand)(u,r,{pool:!1,timeoutMs:6e4,...n}),i=((a.stdout||"")+(a.stderr||"")).trim();return s.push(`$ ${e}${i?`
${i.slice(0,2500)}`:""}`),a},N=e=>Buffer.from(String(e),"utf8").toString("base64"),A=(e,t)=>C(t,`${f} echo '${N(p(e))}' | base64 -d | python3`,{timeoutMs:3e4}),T=async e=>{let t=N(e),s=await (0,o.execCommand)(u,`${f} test -f "${m}/.env" && KEY="$(echo '${t}' | base64 -d)" awk -F= '$1 == ENVIRON["KEY"] && length($2) > 0 { found=1 } END { exit found ? 0 : 1 }' "${m}/.env"`,{pool:!1,timeoutMs:15e3});return 0===s.code},I=async e=>d&&await (0,l.sdAvailable)(u)?("status"!==e&&"stop"!==e&&await S(`systemd ${e}`),await (0,l.ensureInstanceUnit)(u,"hermes",(0,l.gatewayUnit)("hermes",{description:"Hermes gateway",envLines:["EnvironmentFile=-%h/.hermes-%i/.env","EnvironmentFile=-%h/.hermes-%i/instance.env","Environment=HERMES_HOME=%h/.hermes-%i","Environment=PATH=%h/.hermes-%i/hermes-agent/venv/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin"],execStart:"/bin/sh -c 'exec \"$([ -x %h/.hermes-%i/hermes-agent/venv/bin/hermes ] && echo %h/.hermes-%i/hermes-agent/venv/bin/hermes || command -v hermes || echo %h/.local/bin/hermes)\" gatew''ay run'",logFile:"%h/.hermes-%i/logs/gateway.log"})),(0,l.sdInstanceCtl)(u,"hermes",d,e)):null,_=async e=>{if(d){if("stop"===e){let t=await I("stop"),s=await P(e);return{ok:!!t&&t.ok||s.ok,out:`${t?`systemd:${t.out||"ok"} `:""}${s.out}`}}if("status"!==e){let t=await I(e);if(t)return t;await S(`legacy ${e}`)}}return P(e)},P=async e=>{let t=await (0,o.execCommand)(u,`p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -n "$p" ] && echo "HBIN=$p"
DC=0; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && DC=1
echo "DC=$DC"
[ "$DC" = '1' ] && docker exec hermes-agent sh -c 'command -v hermes' 2>/dev/null | head -1 | { read -r cb; [ -n "$cb" ] && echo "CBIN=$cb"; }
true`,{pool:!1,timeoutMs:3e4}),s=t.stdout||"",n=/DC=1/.test(s),r=(s.match(/HBIN=(.*)/)?.[1]||"").trim(),a=(s.match(/CBIN=(.*)/)?.[1]||"").trim();if(!r&&!a)return{ok:!1,out:"hermes binary not found (host or container)"};let i=/SYSTEMD=1/.test(t.stdout||"");if(d){let t=`${m}/hermes-agent/venv/bin/hermes`,s=await (0,o.execCommand)(u,`[ -x "${t}" ] && echo LOCAL_BIN=1 || true`,{pool:!1,timeoutMs:15e3});if(/LOCAL_BIN=1/.test(s.stdout||""))return l(e,t,i)}if(n&&a)return E(a),c(e,n);return r?E(r):E("/usr/local/bin/hermes"),l(e,r||"/usr/local/bin/hermes",i);function l(t,s,n){let r=E(s.replace(/\/\/[^/]+$/,"")),a=`export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH=${r}:$PATH`,i=`${m}/daemon.pid`,l=d?`export HERMES_HOME=${m}; `:"",c='(systemctl --user is-active hermes-gate""way 2>/dev/null || systemctl is-active hermes-gate""way 2>/dev/null) | grep -qx active';if("status"===t)return(0,o.execCommand)(u,`${a}; ${l}if [ -f "${i}" ] && kill -0 $(cat "${i}") 2>/dev/null; then echo PROC_ACTIVE; elif ${c}; then echo PROC_ACTIVE;  else echo NO_PROC; fi`,{pool:!1,timeoutMs:3e4}).then(e=>({ok:!0,active:/PROC_ACTIVE/.test(e.stdout||"")}));if("stop"===t)return(0,o.execCommand)(u,`${a}; ${l}${n?'timeout 25 systemctl stop hermes-gate""way 2>/dev/null; timeout 25 systemctl --user stop hermes-gate""way 2>/dev/null; ':""} if [ -f "${i}" ]; then kill -9 $(cat "${i}") 2>/dev/null; rm -f "${i}"; fi; echo GW_STOPPED`,{pool:!1,timeoutMs:6e4}).then(e=>({ok:/GW_STOPPED/.test(e.stdout||""),out:((e.stdout||"")+(e.stderr||"")).slice(-400)}));let p="restart"===e||"restart"===t?`if [ -f "${i}" ]; then kill -9 $(cat "${i}") 2>/dev/null; rm -f "${i}"; sleep 1; fi; `:"",h=`mkdir -p "${m}/logs"; ${l}setsid nohup sh -c 'set -a; [ -f "${m}/instance.env" ] && . "${m}/instance.env"; [ -f "${m}/.env" ] && . "${m}/.env"; set +a; exec ${E(s)} gateway run || exec ${E(s)} gateway' >> "${m}/logs/gateway-nohup.log" 2>&1 < /dev/null & echo $! > "${i}"; sleep 4; if kill -0 $(cat "${i}") 2>/dev/null; then echo 'GW_UP'; else echo GW_DOWN; tail -5 "${m}/logs/gateway-nohup.log" 2>/dev/null; fi`,$=`${a}; ${l}sleep 3; if [ -f "${i}" ] && kill -0 $(cat "${i}") 2>/dev/null; then echo ALIVE; elif ${c}; then echo ALIVE; elif pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1; then echo ALIVE; else echo DEAD; fi`,g=async e=>{let t=e.stdout||"";if(/GW_UP/.test(t))return{ok:!0,out:t.slice(-200)};if(/already running/i.test(t)){let e=await (0,o.execCommand)(u,`${a}; ${l}timeout 90 ${E(s)} gateway restart 2>&1 || ${h}`,{pool:!1,timeoutMs:12e4}),n=await (0,o.execCommand)(u,$,{pool:!1,timeoutMs:3e4});return{ok:/ALIVE/.test(n.stdout||""),out:("auto-replaced running instance: "+(e.stdout||t)).slice(-300)}}return{ok:!1,out:t.slice(-300)}};if(n){let t="restart"===e?"try-restart":"start";return(0,o.execCommand)(u,`${a}; ${p}timeout 40 systemctl ${t} hermes-gate""way 2>/dev/null || timeout 40 systemctl --user ${verb||"start"} hermes-gate""way 2>/dev/null || ${h}`,{pool:!1,timeoutMs:12e4}).then(g)}return(0,o.execCommand)(u,`${a}; ${p}${h}`,{pool:!1,timeoutMs:9e4}).then(g)}async function c(e,t){if(E(t),"status"===e){let e=await (0,o.execCommand)(u,"docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo ACTIVE || echo INACTIVE",{pool:!1,timeoutMs:3e4});return{ok:!0,active:/ACTIVE/.test(e.stdout||"")}}if("stop"===e){let e=await (0,o.execCommand)(u,"timeout 15 docker exec hermes-agent pkill -f '[h]ermes.*gatew[a]y'; echo GW_STOPPED",{pool:!1,timeoutMs:45e3});return{ok:/GW_STOPPED/.test(e.stdout||""),out:(e.stdout||"").slice(-300)}}"restart"===e&&await (0,o.execCommand)(u,"docker exec hermes-agent pkill -f '[h]ermes.*gatew[a]y' 2>/dev/null; sleep 2; echo KILLED",{pool:!1,timeoutMs:45e3});let s=await (0,o.execCommand)(u,`docker exec -d hermes-agent bash -c 'mkdir -p /root/.hermes/logs && PATH=/usr/local/bin:/usr/bin:/bin:$PATH nohup sh -c "exec ${E(t)} gatew""ay run || exec ${E(t)} gatew""ay" >> /root/.hermes/logs/gateway-nohup.log 2>&1 < /dev/null &' && sleep 3 && docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo GW_STARTED`,{pool:!1,timeoutMs:6e4});return{ok:/GW_STARTED/.test(s.stdout||""),out:(s.stdout||"").slice(-200)}}};if("instances"===r){let e=await (0,l.listInstances)(u,"hermes");return n.NextResponse.json({success:!0,instances:e})}if("spawn-instance"===r){let e=String(a&&a.tag||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,24);if(!e)return n.NextResponse.json({success:!1,error:"Instance tag is required"},{status:400});let t=await (0,o.execCommand)(u,`
if [ -d "$HOME/.hermes-${e}" ]; then
  echo "EXISTS"
else
  # Fresh instance home with a valid default config.yaml (non-secret baseline).
  # .env is the ONLY thing kept empty — credential isolation stays intact, but
  # the gateway can start, persist pairing, and respond from the very first boot.
  mkdir -p "$HOME/.hermes-${e}" "$HOME/.hermes-${e}/logs" "$HOME/.hermes-${e}/memories" "$HOME/.hermes-${e}/workspace" "$HOME/.hermes-${e}/skills" "$HOME/.hermes-${e}/sessions" "$HOME/.hermes-${e}/kanban"
  if [ -s "$HOME/.hermes/config.yaml" ]; then
    cp "$HOME/.hermes/config.yaml" "$HOME/.hermes-${e}/config.yaml"
  else
    : > "$HOME/.hermes-${e}/config.yaml"
  fi
  : > "$HOME/.hermes-${e}/.env"
  echo CLONED_FRESH
fi
chmod 700 "$HOME/.hermes-${e}" 2>/dev/null || true
chmod 600 "$HOME/.hermes-${e}/.env" 2>/dev/null || true
chmod 600 "$HOME/.hermes-${e}/config.yaml" 2>/dev/null || true
`,{pool:!1,timeoutMs:3e4});if(!/CLONED_FRESH|EXISTS/.test(t.stdout||""))return n.NextResponse.json({success:!1,error:"Failed to clone instance home: "+((t.stdout||"")+(t.stderr||"")).slice(-200),log:s});let r=/EXISTS/.test(t.stdout||"");await S("spawn");let i=null;if(!r){let t=await (0,l.copyInstanceBin)(u,"hermes",e,`$HOME/.hermes-${e}`);i=t.err||(t.copied?"own binary copied":t.already?"own binary already present":"no source to copy")}return n.NextResponse.json({success:!0,instance:e,existed:r,started:!1,needsConfiguration:!0,output:r?`Instance "${e}" already exists and is waiting for configuration.`:`Instance "${e}" is ready to configure. ${i}. Add its own provider API key and messenger token, then install/reconfigure to start the gateway.`,log:s})}if("status"===r){let e=await (0,o.execCommand)(u,R(d),{pool:!0,timeoutMs:3e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim(),s="SET"===t("BIN")&&("1"===t("DIR")||"1"===t("CONFIG")||"1"===t("ENVFILE")||"1"===t("CODE")),r="1"===t("DCONT"),a="1"===t("CGW"),i=t("CVERSION")||null,l="1"===t("USVC")||"1"===t("SSVC")||"1"===t("PROC")||r&&a,c=s||r&&(a||!!i)||l;return n.NextResponse.json({success:!0,installed:c,version:c?s?t("VERSION"):i||t("VERSION"):null,running:l,service:"1"===t("SSVC")?"system":"1"===t("USVC")?"user":"1"===t("PROC")?"process":r&&a?"docker":null,hasConfig:"1"===t("CONFIG"),hasEnvFile:"1"===t("ENVFILE"),prereqs:{git:t("GIT"),curl:"1"===t("CURL"),xz:"1"===t("XZ"),systemd:"1"===t("SYSTEMD"),passwordlessSudo:"1"===t("SUDO")}})}if("uninstall"===r){if(d){await (0,l.sdInstanceCtl)(u,"hermes",d,"stop"),await C("stop instance process",`\
for p in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
  [ -d "/proc/$p" ] || continue
  HME="$(tr '\\0' '\\n' < /proc/$p/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
  [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$p/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
  case "$HME" in *".hermes-${d}"|*".hermes-${d}/") kill -9 "$p" 2>/dev/null || true ;; esac
done
if [ -f "${m}/daemon.pid" ]; then
  _p=$(cat "${m}/daemon.pid" 2>/dev/null); [ -n "$_p" ] && { kill "$_p" 2>/dev/null; sleep 1; kill -9 "$_p" 2>/dev/null; }; rm -f "${m}/daemon.pid"
fi
if [ -f "${m}/gateway.pid" ]; then
  _p=$(cat "${m}/gateway.pid" 2>/dev/null); [ -n "$_p" ] && { kill "$_p" 2>/dev/null; sleep 1; kill -9 "$_p" 2>/dev/null; }; rm -f "${m}/gateway.pid"
fi
true`);let e=await C("remove instance home",`rm -rf "${m}" "$HOME/.hermes-${d}"* 2>/dev/null; [ ! -e "${m}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`),t=/REMOVED_INSTANCE/.test(e.stdout||"");return n.NextResponse.json({success:t,purged:i,removedInstance:d,log:s})}await C("stop system service",'(sudo -n systemctl disable --now hermes-gate""way 2>/dev/null || systemctl disable --now hermes-gate""way 2>/dev/null); true'),await C("stop user service",'export XDG_RUNTIME_DIR="/run/user/$(id -u)"; systemctl --user disable --now hermes-gate""way 2>/dev/null; true'),await C("stop stray processes",`\
for p in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes-agent/hermes' 2>/dev/null); do
  grep -qaE 'HERMES_HOME=.+\\.hermes-[^ /]' /proc/$p/environ 2>/dev/null || kill -9 $p 2>/dev/null
done; true`),await C("remove docker container",`command -v docker >/dev/null 2>&1 && docker rm -f hermes-agent 2>/dev/null; ${i?'rm -rf "$HOME/.hermes-docker" 2>/dev/null;':""} true`);let e=!1;try{let t=await (0,l.listInstances)(u,"hermes");e=Array.isArray(t)&&t.filter(e=>e.tag&&e.tag.trim()).length>0}catch{}await C("backup .env",`cp "${m}/.env" "${m}.env.bak" 2>/dev/null; cp "${m}/config.yaml" "${m}.config.yaml.bak" 2>/dev/null; true`);let t=i?'for p in $(pgrep -f \'[h]ermes.*gatew[a]y\' 2>/dev/null); do [ "$p" = "$$" ] && continue; kill -9 $p 2>/dev/null; done; rm -rf "$HOME/.hermes-"* 2>/dev/null; ':"",r=!i&&e?"":'rm -f "$HOME/.local/bin/hermes" /usr/local/bin/hermes 2>/dev/null; sudo -n rm -f /usr/local/bin/hermes 2>/dev/null; ',a=i&&!e?" /usr/local/lib/hermes-agent":"",o=i?`${t}${r}rm -rf "${m}"${a} 2>/dev/null; echo REMOVED_ALL`:`${r}rm -rf "${m}/hermes-agent"${a} 2>/dev/null; echo REMOVED_CODE`,c=await C(i?"remove binary, code & all config":"remove binary & code (config kept)",o),p=/REMOVED/.test(c.stdout||"");return n.NextResponse.json({success:p,purged:i,log:s})}if("details"===r){let e=`
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v hermes 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes" "${m}/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/hermes"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${m}/config.yaml" 2>/dev/null || true
echo "===ENV_B64==="
base64 < "${m}/.env" 2>/dev/null || true
echo "===ENVKEYS==="
grep -E '^[A-Z_]+=' "${m}/.env" 2>/dev/null | cut -d= -f1 || true
echo "===SKILLS==="
# Hermes nests skills as skills/<category>/<skill-name>/; also support flat skills/<skill-name>/
{
  find "${m}/skills" -name "SKILL.md" -o -name "skill.md" 2>/dev/null | while read -r f; do
    basename "$(dirname "$f")"
  done
} 2>/dev/null | sort -u | grep -v '^$' || true
echo "===PROMPT_B64==="
{ base64 < "${m}/custom_instructions.txt" || base64 < "${m}/prompt.txt" || base64 < "${m}/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${m}/SOUL.md" || base64 < "${m}/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
{ base64 < "${m}/USER.md" || base64 < "${m}/memories/USER.md"; } 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "${m}/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${m}/MEMORY.md" || base64 < "${m}/memories/MEMORY.md"; } 2>/dev/null || true
echo "===RUNNING==="
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
${w(d)}
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
echo "SSVC=$SSVC"; echo "USVC=$USVC"; echo "PROC=$PROC"; echo "SYSTEMD=$SYSTEMD"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===MODEL==="
MDL="$( [ -n "$BIN" ] && "$BIN" config get model.default 2>/dev/null | tail -1 || true )"
[ -z "$MDL" ] && MDL="$( [ -n "$BIN" ] && "$BIN" config get model 2>/dev/null | tail -1 || true )"
[ -z "$MDL" ] && MDL="$(grep -E '^s*default:' "${m}/config.yaml" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' | tr -d "'")"
[ -z "$MDL" ] && MDL="$(grep -E '^model:' "${m}/config.yaml" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' | tr -d "'")"
[ -z "$MDL" ] && MDL="$(grep -E '^(MODEL|HERMES_MODEL|DEFAULT_MODEL)=' "${m}/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
echo "$MDL"
`,t=(await (0,o.execCommand)(u,e,{pool:!0,timeoutMs:6e4})).stdout||"",s=(e,s)=>{let n=`===${e}===`,r=t.indexOf(n);if(r<0)return"";let a=r+n.length;if(!s)return t.slice(a).trim();let o=`===${s}===`,i=t.indexOf(o,a);return(i>=0?t.slice(a,i):t.slice(a)).trim()},r="";try{r=Buffer.from(s("CONFIG_B64","ENV_B64"),"base64").toString("utf8")}catch{}let a="";try{a=Buffer.from(s("ENV_B64","ENVKEYS"),"base64").toString("utf8")}catch{}let i=s("ENVKEYS","SKILLS").split("\n").map(e=>e.trim()).filter(Boolean),l=s("SKILLS","PROMPT_B64").split("\n").map(e=>e.trim()).filter(Boolean),c="";try{c=Buffer.from(s("PROMPT_B64","SOUL_B64"),"base64").toString("utf8")}catch{}let p="";try{p=Buffer.from(s("SOUL_B64","USER_B64"),"base64").toString("utf8")}catch{}let h="";try{h=Buffer.from(s("USER_B64","AGENTS_B64"),"base64").toString("utf8")}catch{}let $="";try{$=Buffer.from(s("AGENTS_B64","MEMORY_B64"),"base64").toString("utf8")}catch{}let g="";try{g=Buffer.from(s("MEMORY_B64","RUNNING"),"base64").toString("utf8")}catch{}let f=await (0,o.execCommand)(u,`[ -d "${m}" ] && echo "DIR_EXISTS" || true`,{pool:!0,timeoutMs:15e3}),v=/DIR_EXISTS/.test(f.stdout||""),E=(await (0,o.execCommand)(u,'p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -n "$p" ] && echo "BIN=$p"; command -v docker >/dev/null 2>&1 && docker exec hermes-agent sh -c \'command -v hermes\' 2>/dev/null | head -1 | { read -r cp2; [ -n "$cp2" ] && echo "CBIN=$cp2"; }; true',{pool:!0,timeoutMs:3e4})).stdout||"",b=(E.match(/BIN=(.*)/)?.[1]||E.match(/CBIN=(.*)/)?.[1]||"").trim(),y=await k()===!0,R=!!b&&v||y;return n.NextResponse.json({success:!0,installed:R,version:s("VERSION","MODEL")||null,model:s("MODEL")||null,running:y,binPath:R&&b||null,service:/SSVC=1/.test(t)?"system":/USVC=1/.test(t)?"user":/PROC=1/.test(t)?"process":null,hasSystemd:/SYSTEMD=1/.test(s("RUNNING","VERSION")),configYaml:r,configJson:r,envText:a,envKeys:i,skills:l,systemPrompt:c,promptFiles:{"PROMPT.md":c,"SOUL.md":p,"USER.md":h,"AGENTS.md":$,"MEMORY.md":g}})}if("save-prompt"===r){let e=String(a.prompt||""),t=a.file||"PROMPT.md",s=Buffer.from(e,"utf8").toString("base64"),r=`mkdir -p "${m}" "${m}/memories"
`;return"SOUL.md"===t||"IDENTITY.md"===t?r+=`echo "${s}" | base64 -d > "${m}/SOUL.md"
echo "${s}" | base64 -d > "${m}/IDENTITY.md"
`:"USER.md"===t?r+=`echo "${s}" | base64 -d > "${m}/USER.md"
echo "${s}" | base64 -d > "${m}/memories/USER.md"
`:"AGENTS.md"===t?r+=`echo "${s}" | base64 -d > "${m}/AGENTS.md"
`:"MEMORY.md"===t?r+=`echo "${s}" | base64 -d > "${m}/MEMORY.md"
echo "${s}" | base64 -d > "${m}/memories/MEMORY.md"
`:r+=`echo "${s}" | base64 -d > "${m}/custom_instructions.txt"
echo "${s}" | base64 -d > "${m}/prompt.txt"
echo "${s}" | base64 -d > "${m}/SYSTEM_PROMPT.md"
`,await (0,o.execCommand)(u,r,{pool:!1,timeoutMs:3e4}),!1!==a.restart&&await _("restart"),n.NextResponse.json({success:!0,file:t})}if("reconfigure"===r){let e=a&&a.env||{},t=a&&a.settings||{},r=g(a&&a.provider),i=t.model||t.default_model||e.MODEL||e.HERMES_MODEL||e.DEFAULT_MODEL||"";i&&(t.model=i);let l=String(e.CUSTOM_LLM_API_KEY||"").trim()||String(e.CUSTOM_API_KEY||e.OPENAI_API_KEY||"").trim(),c=String(e.OPENAI_BASE_URL||e.OPENAI_API_BASE||"").trim(),m=null;c&&i&&(m=/z\.ai|api\.bigmodel|zhipu/i.test(c)?"zai":"openai",l&&(e["zai"===m?"ZAI_API_KEY":"OPENAI_API_KEY"]=l,e.CUSTOM_LLM_API_KEY=l));let p=Object.keys(e).filter(t=>null!=e[t]&&""!==e[t]),h=p.find(e=>!/^[A-Z][A-Z0-9_]*$/.test(e));if(h)return n.NextResponse.json({success:!1,error:`Invalid environment variable name: ${h}`},{status:400});let v=Object.keys(t).filter(e=>null!=t[e]&&""!==t[e]).length>0;if(0===p.length&&!v)return n.NextResponse.json({success:!1,error:"No settings or env keys to update"},{status:400});if(r&&!String(e[r]||"").trim()&&!await T(r))return n.NextResponse.json({success:!1,error:`${r} is required before this gateway can start. Paste the selected model provider API key and try again.`},{status:400});if(p.length>0){let t=d?`~/.hermes-${d}/.env`:"~/.hermes/.env",r=await A(p.map(t=>[t,e[t]]),`write ${t}`);if(!/ENV_UPDATED/.test(r.stdout||""))return n.NextResponse.json({success:!1,error:`Failed to write ${t}`,log:s})}let b=a&&a.provider&&a.provider.id&&"custom"!==a.provider.id?a.provider.id:e.OPENROUTER_API_KEY?"openrouter":e.OPENAI_API_KEY?"openai":e.ANTHROPIC_API_KEY?"anthropic":null;if(v||b){let e=Object.entries(t).filter(([,e])=>null!=e&&""!==String(e).trim());if(b&&!e.some(([e])=>"model.provider"===e)&&e.push(["model.provider",b]),e.length>0){let t=d?`~/.hermes-${d}/config.yaml`:"~/.hermes/config.yaml";await C(`merge ${t} settings`,`${f}
            export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
            echo '${N($(e))}' | base64 -d | python3`,{timeoutMs:3e4})}}if((i||b)&&await (0,o.execCommand)(u,`
          export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
          HB="$([ -x "$HOME/.local/bin/hermes" ] && echo "$HOME/.local/bin/hermes" || command -v hermes || echo "/usr/local/bin/hermes")"
          ${i?`${f} $HB config set model.default ${E(i)} 2>&1 || true`:"true"}
          ${b?`${f} $HB config set model.provider ${E(b)} 2>&1 || true`:"true"}
          ${i?`command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && docker exec hermes-agent hermes config set model.default ${E(i)} 2>&1 || true`:"true"}
          ${b?`command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && docker exec hermes-agent hermes config set model.provider ${E(b)} 2>&1 || true`:"true"}
        `,{pool:!1,timeoutMs:3e4}),m&&c){let e;await (0,o.execCommand)(u,`
          export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
          HB="$([ -x "$HOME/.local/bin/hermes" ] && echo "$HOME/.local/bin/hermes" || command -v hermes || echo "/usr/local/bin/hermes")"
          ${f} $HB config set model.provider ${(e=m,E(e))} 2>&1 || true
          ${f} $HB config set model.base_url ${E(c)} 2>&1 || true
          ${f} $HB config set model.default ${E(i)} 2>&1 || true
        `,{pool:!1,timeoutMs:3e4})}let y=await _("restart");return n.NextResponse.json({success:y.ok,restarted:y.ok,startMethod:y.ok?"restart":null,error:y.ok?null:y.error,log:s})}if("save-config"===r){let e=String(a.configJson??a.configToml??a.configYaml??"");if(!e.trim())return n.NextResponse.json({success:!1,error:"config.yaml content is empty"},{status:400});await (0,o.execCommand)(u,`
        cp "${m}/config.yaml" "${m}/config.yaml.bak-$(date +%s)" 2>/dev/null || true
        echo '${N(e)}' | base64 -d > "${m}/config.yaml.new"
        mv "${m}/config.yaml.new" "${m}/config.yaml"
        echo CONFIG_SAVED`,{pool:!1,timeoutMs:3e4});let t=!1,s=!1;if(a.restart&&(t=(await _("restart")).ok,await new Promise(e=>setTimeout(e,6e3)),!(await _("status")).active)){let e=await (0,o.execCommand)(u,`BAK="$(ls -1t "${m}"/config.yaml.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${m}/config.yaml" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,{pool:!1,timeoutMs:3e4});if(/ROLLED_BACK/.test(e.stdout||"")){s=!0,await _("restart"),await new Promise(e=>setTimeout(e,5e3));let t=await _("status");return n.NextResponse.json({success:t.active,restarted:t.active,rolledBack:!0,error:t.active?null:"Rolled back previous config but gateway still down — check ~/.hermes/logs/",log:[`Your saved config broke the gateway — automatically restored ${((e.stdout||"").match(/ROLLED_BACK_TO=(.*)/)||[])[1]||"last backup"}`]})}}return n.NextResponse.json({success:!0,restarted:t,rolledBack:s})}if("logs"===r){let e=Number(a.cursor||0),t=Math.min(Number(a.lines||300),1e3),s=`
ACTIVE=""
for f in "${m}/logs/gatew""ay.log" "${m}/logs/gatew""ay-nohup.log" "${m}-docker/logs/gatew""ay.log" "${m}-docker/logs/gatew""ay-nohup.log"; do
  if [ -f "$f" ] && [ -s "$f" ]; then ACTIVE="$f"; break; fi
done
if [ -z "$ACTIVE" ]; then echo "SIZE=0"; echo "===DATA==="; exit 0; fi
SZ=$(wc -c < "$ACTIVE")
echo "FILE=$(basename "$ACTIVE")"
echo "SIZE=$SZ"
echo "===DATA==="
if [ ${e} -gt 0 ] && [ ${e} -le $SZ ]; then
  tail -c +$((cursor + 1)) "$ACTIVE"
else
  tail -n ${t} "$ACTIVE"
fi
`,r=(await (0,o.execCommand)(u,s,{pool:!1,timeoutMs:45e3})).stdout||"",i=r.match(/SIZE=(\d+)/)?.[1],l=r.match(/FILE=(.*)/)?.[1]?.trim(),c=r.indexOf("===DATA===");return n.NextResponse.json({success:!0,size:i?Number(i):0,file:l||null,data:c>=0?r.slice(c+10):""})}if("health"===r){let e=`
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
PROC=0; pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && PROC=1
DC=0; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && DC=1
if [ "$DC" = '1' ]; then docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && PROC=1; fi
ALIVE=0; [ $SSVC = 1 -o $USVC = 1 -o $PROC = 1 ] && ALIVE=1
echo "ALIVE=$ALIVE"
# Resolve the PID from this instance's OWN pidfile first. A bare
# "pgrep -f '[h]ermes.*gatew[a]y' | head -1" matches EVERY instance on the box
# and would report a sibling's uptime for this one.
PID=""
[ -f "${m}/daemon.pid" ] && PID=$(cat "${m}/daemon.pid" 2>/dev/null)
if [ -z "$PID" ]; then
  for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null); do
    HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
    [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
    # Unattributable process: only the DEFAULT install may adopt it.
    if [ -z "$HME" ]; then ${d?"continue":'PID="$hp"; break'}; fi
    case "$HME" in *".hermes${d?"-"+d:""}") PID="$hp"; break ;; esac
  done
fi
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "${m}/logs/gatew""ay.log" "${m}/logs/gatew""ay-nohup.log" "${m}-docker/logs/gatew""ay.log" "${m}-docker/logs/gatew""ay-nohup.log"; do
  [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break
done
if [ -n "$LOGL" ]; then
  if tail -n 400 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected|sending)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
    TG=error
  fi
  echo "TG=$TG"
  ERRS=$(tail -n 300 "$LOGL" 2>/dev/null | grep -E 'ERROR|CRITICAL' | tail -5)
  EC=0; [ -n "$ERRS" ] && EC=$(printf '%s
' "$ERRS" | wc -l)
  echo "ERRCOUNT=$EC"
  if [ -n "$ERRS" ]; then
    echo "===ERRORS==="
    printf '%s
' "$ERRS"
    echo "===ENDERRORS==="
  fi
else
  echo "TG=unknown"; echo "ERRCOUNT=0"
fi
`,t=(await (0,o.execCommand)(u,e,{pool:!1,timeoutMs:9e4})).stdout||"",s=e=>(t.match(RegExp(`${e}=([^\\n]*)`))||[])[1]?.trim(),r=[],a=t.match(/===ERRORS===([\s\S]*?)===ENDERRORS===/);a&&a[1]&&(r=a[1].trim().split("\n").filter(Boolean));let i="1"===s("ALIVE");return i=await k()===!0,n.NextResponse.json({success:!0,alive:i,instance:d||"default",uptimeSec:Number(s("UPTIME_SEC")||0),telegram:s("TG")||"unknown",errorCount:Number(s("ERRCOUNT")||0),recentErrors:r})}if("pairing-approve"===r){let e=String(a.platform||"").trim(),t=String(a.code||"").trim();if(!t)return n.NextResponse.json({success:!1,error:"Pairing code is required"},{status:400});let r=await (0,o.execCommand)(u,`p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "${m}/hermes-agent/venv/bin/hermes"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`,{pool:!1,timeoutMs:15e3}),i=(r.stdout||"").match(/BIN=(.*)/)?.[1]?.trim()||"hermes",l=E(i),c=`export PATH="${m}/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; ${f} set -a; [ -f "${m}/.env" ] && . "${m}/.env"; set +a`,d=e&&"auto"!==e?`${c}; ${l} pairing approve ${E(e)} ${E(t)} 2>&1 || ${l} pairing approve ${E(t)} 2>&1`:`${c}; ${l} pairing approve ${E(t)} 2>&1 || ${l} pairing approve telegram ${E(t)} 2>&1`,p=await C(`pairing approve ${e?e+" ":""}${t}`,d),h=((p.stdout||"")+(p.stderr||"")).trim(),$=!/error|failed|invalid/i.test(h)||/approved|success|paired/i.test(h);return n.NextResponse.json({success:$,output:h||"Pairing command executed",log:s})}if("pairing-list"===r){let e=await (0,o.execCommand)(u,`p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "${m}/hermes-agent/venv/bin/hermes"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`,{pool:!1,timeoutMs:15e3}),t=(e.stdout||"").match(/BIN=(.*)/)?.[1]?.trim()||"hermes",s=E(t),r=`export PATH="${m}/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; ${f}`,a=(await (0,o.execCommand)(u,`${r}; ${s} pairing list 2>&1 || true; { [ -f "${m}/logs/gateway-nohup.log" ] && tail -n 60 "${m}/logs/gateway-nohup.log"; } || { [ -f "${m}/logs/gateway.log" ] && tail -n 60 "${m}/logs/gateway.log"; } || true`,{pool:!1,timeoutMs:2e4})).stdout||"",i=[...a.matchAll(/pairing\s+approve\s+(?:(\w+)\s+)?([A-Z0-9]{6,12})/gi),...a.matchAll(/code[:\s]+([A-Z0-9]{6,12})/gi),...a.matchAll(/pairing\s+code\s+is\s+([A-Z0-9]{6,12})/gi)],l=[];for(let e of i){let t=e[2]||e[1],s=e[2]?e[1]:"telegram";t&&!l.some(e=>e.code===t)&&l.push({code:t,platform:s||"telegram"})}return n.NextResponse.json({success:!0,pending:l,raw:a.slice(-1e3)})}if("backups"===r){let e=((await (0,o.execCommand)(u,`ls -1t "${m}"/config.yaml.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,{pool:!1,timeoutMs:3e4})).stdout||"").split("\n").filter(Boolean).map(e=>{let t=e.split("|");return{name:t[0],date:t[1]||"",size:Number(t[2])||0}});return n.NextResponse.json({success:!0,backups:e})}if("restore-backup"===r){let e=String(a.name||"");if(!/^config\.yaml\.bak-[0-9]+$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid backup name"},{status:400});let t=await (0,o.execCommand)(u,`[ -f "${m}/${e}" ] && cp "${m}/${e}" "${m}/config.yaml" && echo RESTORED || echo NOT_FOUND`,{pool:!1,timeoutMs:3e4}),s=/RESTORED/.test(t.stdout||""),r=!1;return s&&(r=(await _("restart")).ok),n.NextResponse.json({success:s&&r,restarted:r,error:s?r?null:"restored but gateway did not start":"Backup file not found"})}if("skills"===r){let e=a.op,t=await (0,o.execCommand)(u,'p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes)"; [ -z "$p" ] && [ -x "$HOME/.local/bin/hermes" ] && p="$HOME/.local/bin/hermes"; echo "BIN=$p"',{pool:!1,timeoutMs:15e3}),s=E((t.stdout||"").match(/BIN=(.*)/)?.[1]?.trim()||"");if(!s)return n.NextResponse.json({success:!1,error:"hermes binary not found"},{status:400});if("remove"===e){let e=String(a.name||"");if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid skill name"},{status:400});let t=await (0,o.execCommand)(u,`F="$(find "${m}/skills" -mindepth 2 -maxdepth 2 -type d -name '${e}' 2>/dev/null | head -1)"; [ -z "$F" ] && F="$(find "${m}/skills" -mindepth 1 -maxdepth 1 -type d -name '${e}' 2>/dev/null | head -1)"; if [ -n "$F" ]; then rm -rf "$F" && echo SKILL_REMOVED; else ${s} skills remove '${e}' --yes 2>/dev/null || rm -rf "${m}/skills/${e}"; echo SKILL_REMOVED; fi`,{pool:!1,timeoutMs:3e4});return n.NextResponse.json({success:(t.stdout||"").includes("SKILL_REMOVED"),log:[t.stdout||t.stderr]})}if("install"===e||"opt-out"===e||"opt-in"===e||"reset"===e){let t;if("install"===e){let e=String(a.id||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid skill id"},{status:400});t=`${s} skills install '${e}' --force --yes 2>&1 || ${s} skills install '${e}' 2>&1`}else t="reset"===e?`${s} skills reset ${E(String(a.name||""))} --restore --yes 2>&1`:`${s} skills ${e}${"opt-in"===e?" --sync":""} 2>&1`;let r=await (0,o.execCommand)(u,`${t}; echo OP_DONE`,{pool:!1,timeoutMs:18e4});return n.NextResponse.json({success:(r.stdout||"").includes("OP_DONE"),output:((r.stdout||"")+(r.stderr||"")).slice(-3e3)})}if("install-content"===e){let e=String(a.name||a.id||"").trim(),t=e.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"").slice(0,64)||"custom-skill",s=String(a.content||"").trim();s||(s=`# ${e}

Skill definition for ${e}.
`);let r=Buffer.from(s,"utf8").toString("base64");await (0,o.execCommand)(u,`mkdir -p "${m}/skills/custom/${t}"; printf '%s' "${r}" | base64 -d > "${m}/skills/custom/${t}/SKILL.md"`,{pool:!1,timeoutMs:3e4});let i=await _("restart");return n.NextResponse.json({success:!0,restarted:i.ok,output:`Installed skill "${e}" with full content`})}return n.NextResponse.json({success:!1,error:`Unknown skills op: ${e}`},{status:400})}if("gateway"===r){let e=["start","stop","restart"].includes(a.op)?a.op:"status",t=await _(e);if(!t.ok&&"status"===e)return n.NextResponse.json({success:!1,error:t.out});let s={};return s="status"!==e?{active:(await _("status")).active}:{active:!!t.active},n.NextResponse.json({success:!0,op:e,output:t.out||(t.active?"gateway process active":""),...s})}if("install"!==r)return n.NextResponse.json({success:!1,error:`Unknown action: ${r}`},{status:400});s.push(`> [install] Initializing ${a.docker?.enabled?"Docker-isolated":"direct"} installation for Hermes Agent...`),s.push(`> [install] Target connection: ${t}`);let H=["auto","system","user","nohup"].includes(a.method)?a.method:"auto",D=!1!==a.skipBrowser,L=g(a.provider);if(L&&!String(a.env?.[L]||"").trim())return n.NextResponse.json({success:!1,error:`${L} is required for a fresh install. Paste the selected model provider API key before installing.`},{status:400});let B={ubuntu:"ubuntu:24.04",debian:"debian:12",alma:"almalinux:9",rocky:"rockylinux:9",centos:"quay.io/centos/centos:stream9",fedora:"fedora:40",arch:"archlinux:base",leap:"opensuse/leap:15"},U=null;if(a.docker?.enabled&&!(U=B[a.docker.image]||null))return n.NextResponse.json({success:!1,error:`Unknown distro: ${a.docker.image}. Choose one of: ${Object.keys(B).join(", ")}`},{status:400});s.push("> [probe] Checking host system capabilities...");let V=await C("host probe",R(d));if(a.docker?.enabled){if("1"!==(V.stdout||"").match(RegExp("DOCKER=(.*)"))?.[1]?.trim())return n.NextResponse.json({success:!1,error:'Docker is not available on the selected server — choose "directly on server" or install Docker first.',log:s});if(s.push(`> [docker] Starting isolated container (${U})...`),await C(`start isolated container (${U})`,`
        docker rm -f hermes-agent >/dev/null 2>&1 || true
        mkdir -p "${m}-docker"
        docker run -d --name hermes-agent --restart unless-stopped \\
          -v "${m}-docker:/root/.hermes" \\
          ${U} sleep infinity
        sleep 1
        docker exec hermes-agent true && echo CONTAINER_READY`,{timeoutMs:3e5}),!/CONTAINER_READY/.test(s.join("\n").split("$ start isolated container").pop()||""))return n.NextResponse.json({success:!1,error:`Failed to start the ${U} container (often disk space on the server). See log.`,log:s});x=e=>`docker exec -i hermes-agent sh -s <<'HEOF'
${e}
HEOF`}let j=e=>x?x(e):e,G=!!x;s.push("> [probe] Checking target environment prerequisites...");let q=await (0,o.execCommand)(u,j(R(d)),{pool:!1,timeoutMs:6e4}),z=e=>(q.stdout||"").match(RegExp(`${e}=(.*)`))?.[1]?.trim(),K="1"===z("SYSTEMD"),F="1"===z("SUDO"),Y="1"!==z("ATOMIC"),Z="1"!==z("CXX"),X="1"!==z("TAR"),W="1"!==z("PROCP");if("NONE"===z("GIT")||"1"!==z("CURL")||"1"!==z("XZ")||Y||Z||X||W){let e=[["git","NONE"===z("GIT")],["curl","1"!==z("CURL")],["xz","1"!==z("XZ")],["tar",X]].filter(e=>e[1]).map(e=>e[0]),t=t=>e.concat(t.filter(Boolean)).join(" "),n=t(["xz-utils","gzip",Y&&"libatomic1",Z&&"build-essential","procps"]),r=t(["gzip",Y&&"libatomic",Z&&"g++ make","procps"]),a=t(["gzip",Y&&"libatomic",Z&&"gcc-c++ make","procps-ng"]),i=t(["gzip",Y&&"libatomic1",Z&&"gcc-c++ make","procps"]);t(["libatomic",Z&&"base-devel","procps"]),s.push(`> [prereqs] Installing missing system packages: ${n||a}...`);let l=`export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export DEBIAN_FRONTEND=noninteractive
S="${F?"sudo -n":""}"
(command -v apt-get >/dev/null 2>&1 && $S apt-get update -qq 2>/dev/null; $S apt-get install -y ${n}) < /dev/null ||
(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache ${r}) < /dev/null ||
(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing ${a}) < /dev/null ||
(command -v yum    >/dev/null 2>&1 && $S yum install -y ${a}) < /dev/null ||
(command -v zypper >/dev/null 2>&1 && { sed -i 's|^gpgcheck.*|gpgcheck = 0|' /etc/zypp/zypp.conf 2>/dev/null || echo 'gpgcheck = 0' >> /etc/zypp/zypp.conf; } && $S zypper --non-interactive --no-gpg-checks install ${i} && { command -v pip3 >/dev/null 2>&1 && $S pip3 install -q uv 2>/dev/null || true; }) < /dev/null ||
(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed git curl xz libatomic make) < /dev/null ||
echo PREREQ_SKIPPED
command -v pgrep >/dev/null 2>&1 ||
(command -v apt-get >/dev/null 2>&1 && $S apt-get install -y procps) < /dev/null ||
(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache procps) < /dev/null ||
(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing procps-ng) < /dev/null ||
(command -v yum    >/dev/null 2>&1 && $S yum install -y procps-ng) < /dev/null ||
(command -v zypper >/dev/null 2>&1 && $S zypper --non-interactive --no-gpg-checks install procps) < /dev/null ||
(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed procps-ng) < /dev/null ||
true
touch /tmp/.prereq-done`;await C(`install prerequisites (${n||a})`,`
        rm -f /tmp/.prereq-done
        echo '${N(l)}' | base64 -d > /tmp/prereq.sh
        nohup sh /tmp/prereq.sh > /tmp/prereq.log 2>&1 < /dev/null &
        sleep 1
        test -f /tmp/prereq.log && echo BG_PREREQ_STARTED`,{timeoutMs:6e4});for(let e=0;e<40;e++){await new Promise(e=>setTimeout(e,4e3));let t=await (0,o.execCommand)(u,j("test -f /tmp/.prereq-done && echo DONE || echo PENDING"),{pool:!1,timeoutMs:2e4});if(/DONE/.test(t.stdout||"")){s.push("> [prereqs] Prerequisite packages installed.");break}(e+1)%3==0&&s.push(`> [prereqs] Package manager working in background... (${(e+1)*4}s elapsed)`)}}let J=["--non-interactive","--skip-setup",...D?["--skip-browser"]:[],...a.lightweight?["--no-skills"]:[]].join(" ");s.push(`> [installer] Running official installer: curl -fsSL ${b} | bash -s -- ${J}`),s.push("> [installer] Building Python environment and pulling dependencies (this typically takes 1-3 minutes)...");{let e=0,t=await (0,c.execDetached)(u,`curl -fsSL ${b} | bash -s -- ${J} 2>&1`,{pollMs:2e3,timeoutMs:9e5,onLine:t=>{++e<=400&&s.push(t)}});s.push(`$ official installer (${J})${0!==t.code?` — exited ${t.code}`:" — finished"}${e>400?` (${e} lines total)`:""}${t.stderr?`
${t.stderr.slice(0,300)}`:""}`)}await C("launcher recovery check",`
      p="$(export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; command -v hermes 2>/dev/null)"
      [ -n "$p" ] && echo LAUNCHER_PRESENT && exit 0
      for v in "${m}/hermes-agent/venv/bin/hermes" /usr/local/lib/hermes-agent/venv/bin/hermes /usr/local/lib/hermes-agent/hermes; do
        [ -x "$v" ] || continue
        mkdir -p "$HOME/.local/bin"
        ln -sf "$v" /usr/local/bin/hermes 2>/dev/null || ln -sf "$v" "$HOME/.local/bin/hermes"
        echo "LAUNCHER_RECOVERED from $v"
        break
      done`);let Q=await (0,o.execCommand)(u,j('export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; p="$(command -v hermes 2>/dev/null)"; [ -z "$p" ] && [ -x "$HOME/.local/bin/hermes" ] && p="$HOME/.local/bin/hermes"; [ -n "$p" ] && echo "BIN=$p" || echo BIN_MISSING'),{pool:!1,timeoutMs:15e3}),ee=(Q.stdout||"").match(/BIN=(.*)/)?.[1]?.trim();if(!ee)return n.NextResponse.json({success:!1,error:"Installer finished but the hermes binary was not found (~/.local/bin/hermes or /usr/local/bin/hermes). See log output.",log:s});let et=E(ee),es=E(String(ee).replace(/\/hermes$/,"")),en=`export PATH="${es}:$HOME/.local/bin:$PATH"; export XDG_RUNTIME_DIR="/run/user/$(id -u)"`,er=Object.entries(a.env||{}).filter(([e,t])=>e&&null!=t&&""!==String(t).trim()),ea=er.find(([e])=>!/^[A-Z][A-Z0-9_]*$/.test(e))?.[0];if(ea)return n.NextResponse.json({success:!1,error:`Invalid environment variable name: ${ea}`},{status:400});let eo=`${d?`~/.hermes-${d}`:"~/.hermes"}/.env`;await C(`ensure ${eo}`,`mkdir -p "${m}" && touch "${m}/.env" && chmod 600 "${m}/.env"`,{timeoutMs:15e3});let ei=N(`import os
p = os.path.expanduser("${m}.env.bak")
if not os.path.exists(p):
    print("BACKUP_NONE")
else:
    for ln in open(p).read().splitlines():
        idx = ln.find("=")
        if idx > 0:
            print(ln[:idx])
    print("BACKUP_DONE")`),el=await C("read backup credentials",`echo '${ei}' | base64 -d | python3`,{timeoutMs:15e3}),ec=[...new Set([...(el.stdout||"").matchAll(/^([A-Z][A-Z0-9_]*)$/gm)].map(e=>e[1]))];if(ec.length>0){let e=await C("restore backup credentials",`
        python3 - <<'PY'
import os
src = os.path.expanduser("${m}.env.bak")
dst = os.path.expanduser("${m}/.env")
keys = set("${ec.join(",")}".split(','))
if os.path.exists(src):
    keep = [ln for ln in open(src).read().splitlines()
            if ln.find('=') > 0 and ln[:ln.find('=')] in keys]
    cur = [ln for ln in (open(dst).read().splitlines() if os.path.exists(dst) else [])
           if not (ln.find('=') > 0 and ln[:ln.find('=')] in keys)]
    text = '\\n'.join(cur + keep) + '\\n'
    open(dst, 'w').write(text)
    os.chmod(dst, 0o600)
    print('BACKUP_RESTORED')
PY`,{timeoutMs:3e4});/BACKUP_RESTORED/.test(e.stdout||"")&&await C("clear backup",`rm -f "${m}.env.bak"`,{timeoutMs:15e3})}if(er.length>0){let e=await A(er.map(([e,t])=>[e,String(t).trim()]),`write ${er.length} key(s) to ${eo}`);if(!/ENV_UPDATED/.test(e.stdout||""))return n.NextResponse.json({success:!1,error:`Failed to save credentials to ${eo}; gateway was not started.`,log:s})}let eu=Object.entries(a.settings||{}).filter(([,e])=>null!=e&&""!==String(e).trim());a.lightweight&&!eu.some(([e])=>"auxiliary.free_only"===e)&&eu.push(["auxiliary.free_only","true"]);let ed=a.provider&&a.provider.id&&"custom"!==a.provider.id?a.provider.id:a.env?.OPENROUTER_API_KEY?"openrouter":a.env?.OPENAI_API_KEY?"openai":a.env?.ANTHROPIC_API_KEY?"anthropic":null;ed&&!eu.some(([e])=>"model.provider"===e)&&eu.push(["model.provider",ed]);let em=a.settings&&a.settings.model||a.env&&(a.env.MODEL||a.env.HERMES_MODEL||a.env.DEFAULT_MODEL)||"";for(let[e,t]of(em&&!eu.some(([e])=>"model"===e||"model.default"===e)&&eu.push(["model.default",em]),eu)){let s=h(e);await C(`hermes config set ${s}${d?` (→ ~/.hermes-${d})`:""}`,`${en}; ${f} ${et} config set ${s} ${E(String(t))} 2>&1 | tail -2`,{timeoutMs:6e4})}if(eu.length>0){let e=d?`~/.hermes-${d}/config.yaml`:"~/.hermes/config.yaml";await C(`merge ${e} settings (guaranteed write)`,`${f} ${en}; echo '${N($(eu))}' | base64 -d | python3`,{timeoutMs:3e4})}let ep=a.env&&a.env.TELEGRAM_BOT_TOKEN||"";(em||ed||ep)&&await (0,o.execCommand)(u,`
        export PATH="${es}:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
        HB="$([ -x "$HOME/.local/bin/hermes" ] && echo "$HOME/.local/bin/hermes" || command -v hermes || echo "/usr/local/bin/hermes")"
        ${em?`${f} $HB config set model.default ${E(String(em))} 2>&1 | tail -1 || true`:"true"}
        ${ed?`${f} $HB config set model.provider ${E(String(ed))} 2>&1 | tail -1 || true`:"true"}
        ${ep?`${f} $HB config set gateway.platforms.telegram.token ${E(String(ep))} 2>&1 | tail -1 || true`:"true"}
        true`,{pool:!1,timeoutMs:4e4});let eh=H;"auto"===eh&&(eh=K?F?"system":"user":"nohup");let e$=!1;if(d&&!G){if(await S("install"),"nohup"!==eh){let e=await I("start");e$=!!(e&&e.ok)}if(!e$&&"nohup"!==eh&&K){await C("install instance service (HERMES_HOME-qualified)",`${en}; ${f} ${et} gateway install 2>&1 | tail -5; ${f} ${et} gateway start 2>&1 | tail -3; echo SVC_DONE`,{timeoutMs:12e4});let e=await (0,o.execCommand)(u,j(`systemctl --user is-active hermes-gate""ay@${d} 2>/dev/null`),{pool:!1,timeoutMs:15e3});(e$=/active/.test(e.stdout||""))||s.push("> Instance systemd unit not active — falling back to background daemon...")}}else if("system"===eh&&K&&!G){await C("install boot-time system service",`${en}; $S ${et} gateway install --system 2>&1 | tail -6; $S ${et} gateway start --system 2>&1 | tail -3; echo SVC_DONE`,{timeoutMs:12e4});let e=await (0,o.execCommand)(u,j("systemctl is-active hermes-gateway 2>/dev/null || systemctl is-active hermes 2>/dev/null"),{pool:!1,timeoutMs:15e3});(e$=/active/.test(e.stdout||""))||s.push("> Systemd service not active on this environment — falling back to background daemon...")}if(!e$&&!d&&("user"===eh||"system"===eh&&K)&&K&&!G){await C("install user service + enable lingering",`${en}; ${et} gateway install 2>&1 | tail -5; ${et} gateway start 2>&1 | tail -3; ${F?'sudo -n loginctl enable-linger "$(id -un)" 2>/dev/null;':""} echo SVC_DONE`,{timeoutMs:12e4});let e=await (0,o.execCommand)(u,j("systemctl --user is-active hermes-gateway 2>/dev/null || systemctl --user is-active hermes 2>/dev/null"),{pool:!1,timeoutMs:15e3});(e$=/active/.test(e.stdout||""))||s.push("> User service not active — falling back to background daemon...")}e$||await C("start gateway (background daemon)",`${en}; export HERMES_HOME="${m}"; mkdir -p "${m}/logs"; setsid nohup sh -c 'set -a; [ -f "${m}/instance.env" ] && . "${m}/instance.env"; [ -f "${m}/.env" ] && . "${m}/.env"; set +a; export PATH="${es}:$HOME/.local/bin:/usr/local/bin:$PATH"; exec ${et} gatew""ay run || exec ${et} gatew""ay' >> "${m}/logs/gateway-nohup.log" 2>&1 < /dev/null & sleep 3; { pgrep -f '[h]ermes.*gatew[a]y' || pgrep -f '[h]ermes gatew[a]y'; } >/dev/null 2>&1 && echo GW_RUNNING || echo GW_PENDING`,{timeoutMs:3e4}),await new Promise(e=>setTimeout(e,3e3));let eg=await (0,o.execCommand)(u,j(R(d)),{pool:!1,timeoutMs:6e4}),ef=e=>(eg.stdout||"").match(RegExp(`${e}=(.*)`))?.[1]?.trim(),ev=G?"1"===ef("PROC"):"1"===ef("SSVC")||"1"===ef("USVC")||"1"===ef("PROC"),eE=null;if(!ev){let e=((await (0,o.execCommand)(u,j(`{ [ -f "${m}/logs/gateway-nohup.log" ] && tail -n 25 "${m}/logs/gateway-nohup.log"; } || { [ -f "${m}/logs/gateway.log" ] && tail -n 25 "${m}/logs/gateway.log"; } || ls -1t "${m}/logs/"*.log 2>/dev/null | head -1 | xargs -r tail -n 25 2>/dev/null || true`),{pool:!1,timeoutMs:15e3})).stdout||"").trim();if(e){s.push(`
=== RECENT GATEWAY LOG ===
${e}`);let t=e.split("\n").filter(Boolean).pop()||"";eE=`Gateway stopped shortly after launch: ${t.slice(0,150)}`}else eE="Gateway did not stay running. Check ~/.hermes/logs/ on the server — most often the LLM API key or messenger token needs attention."}return n.NextResponse.json({success:ev,running:ev,startMethod:G?"docker":eh,docker:G?{image:U,name:"hermes-agent",dataDir:"~/.hermes-docker"}:void 0,version:ef("VERSION"),error:eE,log:s})}catch(e){return u.logger.error("[hermes-install] action failed:",e.message),n.NextResponse.json({success:!1,error:e.message},{status:500})}}e.s(["POST",0,f,"buildEnvUpsertPy",0,p,"buildSettingsMergePy",0,$]),s()}catch(e){s(e)}},!1),60891,e=>{"use strict";var t=e.i(8970),s=e.i(74017),n=e.i(96250),r=e.i(59756),a=e.i(61916),o=e.i(74677),i=e.i(69741),l=e.i(16795),c=e.i(87718),u=e.i(95169),d=e.i(47587),m=e.i(66012),p=e.i(70101),h=e.i(26937),$=e.i(10372),g=e.i(93695);e.i(52474);var f=e.i(5232);let v=new t.AppRouteRouteModule({definition:{kind:s.RouteKind.APP_ROUTE,page:"/api/agents/hermes/route",pathname:"/api/agents/hermes",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/agents/hermes/route.js",nextConfigOutput:"",userland:()=>e.r(99747),...{}}),{workAsyncStorage:E,workUnitAsyncStorage:b,serverHooks:y}=v;async function w(e,t,n){n.requestMeta&&(0,r.setRequestMeta)(e,n.requestMeta),v.isDev&&(0,r.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let E="/api/agents/hermes/route";E=E.replace(/\/index$/,"")||"/";let b=await v.prepare(e,t,{srcPage:E,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:y,deploymentId:w,params:R,nextConfig:O,parsedUrl:S,isDraftMode:M,prerenderManifest:k,routerServerContext:x,isOnDemandRevalidate:C,revalidateOnlyGenerated:N,resolvedPathname:A,clientReferenceManifest:T,serverActionsManifest:I}=b,_=(0,i.normalizeAppPath)(E),P=!!(k.dynamicRoutes[_]||k.routes[A]),H=async()=>((null==x?void 0:x.render404)?await x.render404(e,t,S,!1):t.end("This page could not be found"),null);if(P&&!M){let e=!!k.routes[A],t=k.dynamicRoutes[_];if(t&&!1===t.fallback&&!e){if(O.adapterPath)return await H();throw new g.NoFallbackError}}let D=null;!P||v.isDev||M||(D="/index"===(D=A)?"/":D);let L=!0===v.isDev||!P,B=P&&!L;I&&T&&(0,o.setManifestsSingleton)({page:E,clientReferenceManifest:T,serverActionsManifest:I});let U=e.method||"GET",V=(0,a.getTracer)(),j=V.getActiveScopeSpan(),G=!!(null==x?void 0:x.isWrappedByNextServer),q=!!(0,r.getRequestMeta)(e,"minimalMode"),z=(0,r.getRequestMeta)(e,"incrementalCache")||await v.getIncrementalCache(e,O,k,q);null==z||z.resetRequestCache(),globalThis.__incrementalCache=z;let K={params:R,previewProps:k.preview,renderOpts:{experimental:{authInterrupts:!!O.experimental.authInterrupts,useCacheTimeout:O.experimental.useCacheTimeout},cacheComponents:!!O.cacheComponents,validationLevel:O.experimental.instantInsights.validationLevel,supportsDynamicResponse:L,incrementalCache:z,hmrRefreshHash:(0,r.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:O.cacheLife,staticPageGenerationTimeout:O.staticPageGenerationTimeout,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,s,n,r)=>v.onRequestError(e,t,n,r,x)},sharedContext:{buildId:y,deploymentId:w}},F=new l.NodeNextRequest(e),Y=new l.NodeNextResponse(t),Z=c.NextRequestAdapter.fromNodeNextRequest(F,(0,c.signalFromNodeResponse)(t)),X=async({previousCacheEntry:s})=>{try{if(!q&&C&&N&&!s)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await v.handle(Z,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let a=K.renderOpts.pendingWaitUntil;a&&n.waitUntil&&(n.waitUntil(a),a=void 0);let o=K.renderOpts.collectedTags;if(!P)return await (0,m.sendResponse)(F,Y,r,a),null;{let e=await r.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(r.headers);o&&(t[$.NEXT_CACHE_TAGS_HEADER]=o),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let s=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=$.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,n=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=$.INFINITE_CACHE?!1!==s&&s>0?O.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:s,expire:n}}}}catch(t){throw(null==s?void 0:s.isStale)&&await v.onRequestError(e,t,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:B,isOnDemandRevalidate:C})},!1,x),t}},W=async(r,o)=>{try{var i,l;let r=await v.handleResponse({req:e,nextConfig:O,cacheKey:D,routeKind:s.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:N,responseGenerator:X,waitUntil:n.waitUntil,isMinimalMode:q});if(!P)return;if((null==r||null==(i=r.value)?void 0:i.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==r||null==(l=r.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});q||t.setHeader("x-nextjs-cache",C?"REVALIDATED":r.isMiss?"MISS":r.isStale?"STALE":"HIT"),M&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let a=(0,p.fromNodeOutgoingHttpHeaders)(r.value.headers);q&&P||a.delete($.NEXT_CACHE_TAGS_HEADER),!r.cacheControl||t.getHeader("Cache-Control")||a.get("Cache-Control")||a.set("Cache-Control",(0,h.getCacheControlHeader)(r.cacheControl)),await (0,m.sendResponse)(F,Y,new Response(r.value.body,{headers:a,status:r.value.status||200}));return}catch(t){if(t instanceof g.NoFallbackError||await v.onRequestError(e,t,{routerKind:"App Router",routePath:_,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:B,isOnDemandRevalidate:C})},!1,x),P)throw t;await (0,m.sendResponse)(F,Y,new Response(null,{status:500}));return}finally{(()=>{if(!r)return;let e=t.statusCode;r.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(r.setStatus({code:a.SpanStatusCode.ERROR}),r.setAttribute("error.type",e.toString()));let s=V.getRootSpanAttributes();if(!s)return;if(s.get("next.span_type")!==u.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${s.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=s.get("next.route")||_,i=`${U} ${n}`;r.setAttributes({"next.route":n,"http.route":n,"next.span_name":i}),r.updateName(i),o&&o!==r&&(o.setAttribute("http.route",n),o.updateName(i))})()}};if(G&&j)await W(j,void 0);else{let t=V.getActiveScopeSpan();await V.withPropagatedContext(e.headers,()=>V.trace(u.BaseServerSpan.handleRequest,{spanName:`${U} ${E}`,kind:a.SpanKind.SERVER,attributes:{"http.method":U,"http.target":e.url}},e=>W(e,t)),void 0,!G)}}e.s(["handler",0,w,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:E,workUnitAsyncStorage:b})},"routeModule",0,v,"serverHooks",0,y,"workAsyncStorage",0,E,"workUnitAsyncStorage",0,b])}];

//# sourceMappingURL=_1q5kfx9._.js.map