module.exports=[11364,e=>e.a(async(t,n)=>{try{var o=e.i(89171),s=e.i(23667),a=e.i(80533),r=e.i(47185),i=e.i(43185),l=e.i(69683),c=e.i(51631),d=e.i(67723),p=e.i(37034),u=t([a,r,l,d]);[a,r,l,d]=u.then?(await u)():u;let h=p.shellQuote,f=(e,t,n)=>{let o=n?[`nanobot-gatew""ay@${n}`,'nanobot-gatew""ay',"nanobot"]:['nanobot-gatew""ay',"nanobot"];return`
GW_PID=""
# 1) pidfile — only trusted when the PID is alive AND really is a nanobot process
if [ -f "${t}" ]; then
  P=$(tr -cd '0-9' < "${t}" 2>/dev/null)
  if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then
    CMDL=$(tr '\\0' ' ' < "/proc/$P/cmdline" 2>/dev/null)
    [ -z "$CMDL" ] && CMDL=$(ps -p "$P" -o args= 2>/dev/null)
    case "$CMDL" in *nanobot*) GW_PID="$P";; esac
  fi
fi
# 2) systemd — per-instance template unit, then the plain default unit
if [ -z "$GW_PID" ]; then
  [ -n "$XDG_RUNTIME_DIR" ] || export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  for u in ${o.join(" ")}; do
    if { systemctl --user is-active "$u" 2>/dev/null || systemctl is-active "$u" 2>/dev/null; } | grep -qx active; then
      GW_PID="systemd:$u"; break
    fi
  done
fi
# 3) process scan scoped to THIS instance: a nanobot gateway whose command line
#    points at this instance home (--config / workspace / --port).
#    The GWPID guard drops OUR OWN remote shell, whose argv literally contains
#    this script (and therefore the word nanobot and the unit names above).
if [ -z "$GW_PID" ]; then
  for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
    [ -r "/proc/$p/cmdline" ] || continue
    C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
    [ -n "$C" ] || continue
    case "$C" in *GWPID*) continue;; esac
    case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
    case "$C" in *"${e}"*) GW_PID="$p"; break;; esac
  done
fi
# 4) default install: launched as bare "nanobot gateway" with NO --config flag,
#    so nothing in its command line names the home. Fall back to a broad scan
#    that excludes tagged-instance homes (.nanobot-<tag>) so a running instance
#    can never make the default instance look UP.
if [ -z "$GW_PID" ] && [ -z "${n}" ]; then
  for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
    [ -r "/proc/$p/cmdline" ] || continue
    C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
    [ -n "$C" ] || continue
    case "$C" in *GWPID*) continue;; esac
    case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
    case "$C" in *".nanobot-"*) continue;; esac
    GW_PID="$p"; break
  done
fi
if [ -n "$GW_PID" ]; then echo PROC_ACTIVE; else echo NO_PROC; fi
echo "GWPID=$GW_PID"
`},v=`
export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.nanobot/config.json" ] && CFG=1
echo "CONFIG=$CFG"
PROC=0; pgrep -f '[n]anobot.*gatew[a]y' >/dev/null 2>&1 && PROC=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
GIT=$(git --version 2>/dev/null | awk '{print $3}'); [ -z "$GIT" ] && GIT=NONE
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
PY3=NONE; command -v python3 >/dev/null 2>&1 && PY3=$(python3 --version 2>&1 | awk '{print $2}')
echo "PROC=$PROC"; echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"
echo "GIT=$GIT"; echo "CURL=$CURLP"; echo "PY3=$PY3"
`;async function m(e){try{let t=await (0,s.getServerSession)(a.authOptions);if(!t)return o.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let n=await e.json(),{connectionId:r,action:l,config:c={},purge:d=!1}=n;if((!r||!l)&&"job"!==l)return o.NextResponse.json({success:!1,error:"Missing connectionId or action"},{status:400});if("job"===l)return(0,i.dispatchWithLiveLogs)(n,()=>({}));return(0,i.dispatchWithLiveLogs)(n,(e,n)=>$(e,t,n))}catch(e){return c.logger.error("[agents/nanobot] POST failed:",e?.message),o.NextResponse.json({success:!1,error:e?.message||"Request failed"},{status:500})}}async function $(e,t,n=[]){try{let{connectionId:t,action:s,config:a={},purge:i=!1}=e,c=await (0,r.getSshConfig)(t),p=async(e,t,o={})=>{let s=Array.isArray(t)?t.join("\n"):String(t??""),a=await (0,r.execCommand)(c,s,{pool:!1,timeoutMs:6e4,...o}),i=((a.stdout||"")+(a.stderr||"")).trim();return n.push(`$ ${e}${i?`
${i.slice(0,2500)}`:""}`),a},u=e=>Buffer.from(String(e),"utf8").toString("base64"),m=(0,d.parseInst)(e),$=(0,d.homeDir)("nanobot",m),g=(0,d.instancePort)("nanobot",m),b=`${$}/daemon.pid`,E=()=>`p="${$}/venv/bin/nanobot"; [ ! -x "$p" ] && p="$(export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:/usr/bin:$PATH"; command -v nanobot 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`,O=async e=>{if(m&&await (0,d.sdAvailable)(c)){await (0,d.writeInstanceEnv)(c,$,{NB_PORT:g}),await (0,d.ensureInstanceUnit)(c,"nanobot",(0,d.gatewayUnit)("nanobot",{description:"Nanobot gateway",envLines:["EnvironmentFile=-%h/.nanobot-%i/.env","EnvironmentFile=%h/.nanobot-%i/instance.env","Environment=PATH=%h/.local/bin:%h/.nanobot/venv/bin:/usr/local/bin:/usr/bin:/bin"],execStart:'/bin/sh -c \'exec "$([ -x %h/.nanobot-%i/venv/bin/nanobot ] && echo %h/.nanobot-%i/venv/bin/nanobot || echo %h/.local/bin/nanobot)" gateway --config %h/.nanobot-%i/config.json --workspace %h/.nanobot-%i/workspace --port "$NB_PORT"\'',logFile:"%h/.nanobot-%i/logs/gateway.log"}));let t=await (0,d.sdInstanceCtl)(c,"nanobot",m,e);if(t)return t}let t=await (0,r.execCommand)(c,E(),{pool:!1,timeoutMs:15e3}),n=(t.stdout||"").match(/BIN=(.*)/)?.[1]?.trim();if(!n)return{ok:!1,out:"nanobot binary not found"};let o=h(n),s='export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"',a=` --config "${$}/config.json" --workspace "${$}/workspace"${g?` --port ${g}`:""}`,i=`${s}; ${f($,b,m)}`;if("status"===e){let e=await (0,r.execCommand)(c,i,{pool:!1,timeoutMs:3e4});return{ok:!0,active:/PROC_ACTIVE/.test(e.stdout||"")}}if("stop"===e)return(0,r.execCommand)(c,`${s}; NBSTOPSCAN=1; if [ -f "${b}" ]; then kill $(cat "${b}") 2>/dev/null; sleep 1; kill -9 $(cat "${b}") 2>/dev/null; fi; rm -f "${b}"; for p in $(pgrep -f '[n]anobot' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); [ -n "$C" ] || continue; case "$C" in *NBSTOPSCAN*) continue;; esac; case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac; case "$C" in *"${$}"*) kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null;; esac; done; echo GW_STOPPED`,{pool:!1,timeoutMs:6e4}).then(e=>({ok:/GW_STOPPED/.test(e.stdout||""),out:((e.stdout||"")+(e.stderr||"")).slice(-400)}));"restart"===e&&await O("stop");let l=`${s}; NBSTARTSCAN=1; set -a; [ -f "${$}/.env" ] && . "${$}/.env"; set +a; mkdir -p "${$}/logs" "${$}/workspace"; rm -f "${b}"; setsid nohup ${o} gateway${a} >> "${$}/logs/gateway.log" 2>&1 < /dev/null & echo $! > "${b}"; sleep 4; REAL=$(for p in $(pgrep -f '[n]anobot' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); [ -n "$C" ] || continue; case "$C" in *NBSTARTSCAN*) continue;; esac; case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac; case "$C" in *"${$}"*) echo "$p";; esac; done | head -1); [ -n "$REAL" ] && echo "$REAL" > "${b}"; if kill -0 $(cat "${b}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; fi`;return(0,r.execCommand)(c,l,{pool:!1,timeoutMs:9e4}).then(e=>({ok:/GW_UP/.test(e.stdout||""),out:(e.stdout||"").slice(-200)}))};if("status"===s){let e=await (0,r.execCommand)(c,v,{pool:!0,timeoutMs:3e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim();return o.NextResponse.json({success:!0,installed:"SET"===t("BIN"),version:"SET"===t("BIN")?t("VERSION"):null,running:"1"===t("PROC"),hasConfig:"1"===t("CONFIG"),prereqs:{git:t("GIT"),curl:"1"===t("CURL"),python3:t("PY3"),passwordlessSudo:"1"===t("SUDO")}})}if("instances"===s){let e=await (0,d.listInstances)(c,"nanobot");return o.NextResponse.json({success:!0,instances:e})}if("spawn-instance"===s){let e=String(a&&a.tag||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,24);if(!e)return o.NextResponse.json({success:!1,error:"Instance tag is required"},{status:400});let t=await (0,d.cloneDefaultHome)(c,"nanobot",e,["config.json",".env","workspace/config.json","workspace/PROMPT.md","workspace/SOUL.md","workspace/IDENTITY.md","workspace/USER.md","workspace/AGENTS.md","workspace/MEMORY.md","prompt.txt","workspace/custom_instructions.md"]);if(!t.ok)return o.NextResponse.json({success:!1,error:"Failed to clone nanobot instance home"});g&&await (0,r.execCommand)(c,`python3 - << 'PY'
import json, os
p = os.path.expanduser('${$}/config.json')
try:
    d = json.load(open(p))
except Exception:
    d = {}
d.setdefault('channels', {})['websocket'] = { 'enabled': True, 'port': ${g+1} }
json.dump(d, open(p, 'w'), indent=2)
print('WS_PORT_INJECTED')
PY`,{pool:!1,timeoutMs:3e4});let n=null;if(!t.existed){let t=await (0,d.copyInstanceBin)(c,"nanobot",e,$);n=t.err||(t.copied?"own binary copied":t.already?"own binary already present":"no source to copy")}let s=await O("start");return o.NextResponse.json({success:!0,instance:e,existed:t.existed,started:s.ok,output:t.existed?`Instance "${e}" already existed — gateway ${s.ok?"running":"not started"}.`:`Instance "${e}" spawned and ${s.ok?"running":"failed to start"}. ${n}. Remember: give it its OWN bot token (reconfigure → env) so instances don't fight over the same Telegram bot.`})}if("details"===s){let e=`
export PATH="$HOME/.local/bin:${$}/venv/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"
BIN="${$}/venv/bin/nanobot"
[ -x "$BIN" ] || BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "${$}/venv/bin/nanobot" "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${$}/config.json" 2>/dev/null || true
# Bundled skills ship INSIDE the nanobot package
# (<site-packages>/nanobot/skills) — cron, github, weather, memory, tmux, ...
# They are installed and immediately usable by the bot, but they live outside
# the instance home, so listing only the workspace showed a fraction of what
# the bot actually has. Resolve the package dir through the venv interpreter
# (the nanobot on PATH may be a shim outside the venv), then glob as backup.
NBSK=""
for py in "$(dirname "$BIN" 2>/dev/null)/python" "$HOME/.nanobot/venv/bin/python" "$(command -v python3 2>/dev/null)"; do
  [ -n "$py" ] && [ -x "$py" ] || continue
  NBSK=$("$py" -c 'import nanobot, os; print(os.path.join(os.path.dirname(nanobot.__file__), "skills"))' 2>/dev/null)
  [ -n "$NBSK" ] && [ -d "$NBSK" ] && break
  NBSK=""
done
if [ -z "$NBSK" ]; then
  for d in "$HOME"/.nanobot/venv/lib/python*/site-packages/nanobot/skills; do
    [ -d "$d" ] && NBSK="$d" && break
  done
fi
echo "===SKILLS==="
{
  # 1) user / workspace skill dirs for this instance. Directories are the norm
  #    (each holds a SKILL.md); a bare <name>.md also counts. Files like
  #    README.md are NOT skills, hence -type d / -name '*.md' rather than ls -1.
  for d in "${$}/workspace/skills" "${$}/skills"${m?"":' "$HOME/.nanobot/workspace/skills" "$HOME/.nanobot/skills"'}; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's#.*/##'
    find "$d" -maxdepth 1 -mindepth 1 -type f -name '*.md' 2>/dev/null | sed 's#.*/##; s#\\.md$##'
  done
  # 2) nested skills anywhere under the instance home (a SKILL.md a level or two
  #    down is still an installed skill, e.g. skills/cat/name/SKILL.md)
  for base in "${$}/workspace/skills" "${$}/skills"; do
    [ -d "$base" ] && find "$base" -maxdepth 3 -name 'SKILL.md' 2>/dev/null | while read -r f; do basename "$(dirname "$f")"; done
  done
  # 3) bundled skills shipped inside the nanobot package
  [ -n "$NBSK" ] && [ -d "$NBSK" ] && find "$NBSK" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's#.*/##'
  [ -n "$NBSK" ] && [ -d "$NBSK" ] && find "$NBSK" -maxdepth 2 -name 'SKILL.md' 2>/dev/null | while read -r f; do basename "$(dirname "$f")"; done
} | grep -v '^\\.' | grep -viE '^readme([.-_]|$)' | sort -u || true
echo "===PLUGINS==="
[ -n "$BIN" ] && "$BIN" plugins list 2>/dev/null || true
echo "===SKILLS_BUNDLED==="
[ -n "$NBSK" ] && [ -d "$NBSK" ] && find "$NBSK" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's#.*/##' | grep -v '^\\.' | grep -viE '^readme([.-_]|$)' | sort -u || true
echo "===PROMPT_B64==="
{ base64 < "${$}/workspace/PROMPT.md" || base64 < "${$}/prompt.txt" || base64 < "${$}/workspace/custom_instructions.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${$}/workspace/SOUL.md" || base64 < "${$}/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "${$}/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "${$}/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${$}/workspace/MEMORY.md" || base64 < "${$}/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===RUNNING==="
${f($,b,m)}
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===LOG==="
LOG=""
for f in "${$}/logs/gatew""ay.log" "${$}-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break; done
[ -n "$LOGLAST" ] || true
echo "===LOGFILE==="
LOG=""
for f in "${$}/logs/gatew""ay.log" "${$}-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break; done
[ -z "$LOG" ] && LOG="${$}/logs/gatew""ay.log"
echo "$LOG"
tail -n 30 "$LOG" 2>/dev/null | tail -5
`,t=(await (0,r.execCommand)(c,e,{pool:!0,timeoutMs:6e4})).stdout||"",n=(e,n)=>{let o=`===${e}===`,s=t.indexOf(o);if(s<0)return"";let a=s+o.length;if(!n)return t.slice(a).trim();let r=`===${n}===`,i=t.indexOf(r,a);return(i>=0?t.slice(a,i):t.slice(a)).trim()},s="";try{s=Buffer.from(n("CONFIG_B64","SKILLS"),"base64").toString("utf8")}catch{}let a=n("BINPATH","LOG"),i="";try{i=Buffer.from(n("PROMPT_B64","SOUL_B64"),"base64").toString("utf8")}catch{}let l="";try{l=Buffer.from(n("SOUL_B64","USER_B64"),"base64").toString("utf8")}catch{}let d="";try{d=Buffer.from(n("USER_B64","AGENTS_B64"),"base64").toString("utf8")}catch{}let p="";try{p=Buffer.from(n("AGENTS_B64","MEMORY_B64"),"base64").toString("utf8")}catch{}let u="";try{u=Buffer.from(n("MEMORY_B64","RUNNING"),"base64").toString("utf8")}catch{}let h=new Set,v="";try{for(let e of(v=(await (0,r.execCommand)(c,`[ -f "${$}/.env" ] && cat "${$}/.env" 2>/dev/null || true`,{pool:!0,timeoutMs:15e3})).stdout||"").split("\n")){let t=e.split("=")[0]?.trim();t&&/^[A-Z_][A-Z0-9_]*$/.test(t)&&h.add(t)}}catch{}let g=new Set(n("SKILLS","PLUGINS").split("\n").map(e=>e.trim()).filter(Boolean)),E=new Set(n("SKILLS_BUNDLED","PROMPT_B64").split("\n").map(e=>e.trim()).filter(Boolean));for(let e of n("PLUGINS","SKILLS_BUNDLED").split("\n")){let t=e.match(/│\s*([a-zA-Z0-9_-]+)\s*│\s*[^│]+\s*│\s*yes\s*│/);t&&t[1]&&g.add(t[1].trim())}let O=null,w=[],y=null;try{let e=JSON.parse(s||"{}");for(let t of Object.keys(e.providers||{}))h.add(t.toUpperCase()+"_API_KEY"),e.providers[t]?.apiKey&&!v.includes(`${t.toUpperCase()}_API_KEY`)&&(v+=`
${t.toUpperCase()}_API_KEY=${e.providers[t].apiKey}`);for(let t of Object.keys(e.channels||{}))e.channels[t]?.enabled!==!1&&g.add(t);for(let t of Object.keys(e.plugins||{}))e.plugins[t]?.enabled!==!1&&g.add(t);e.channels?.telegram?.token&&(h.add("TELEGRAM_BOT_TOKEN"),v.includes("TELEGRAM_BOT_TOKEN")||(v+=`
TELEGRAM_BOT_TOKEN=${e.channels.telegram.token}`)),e.channels?.telegram?.allowFrom?.length&&(h.add("TELEGRAM_ALLOWED_USERS"),v.includes("TELEGRAM_ALLOWED_USERS")||(v+=`
TELEGRAM_ALLOWED_USERS=${e.channels.telegram.allowFrom.join(",")}`)),!i&&e.agent?.system_prompt&&(i=e.agent.system_prompt),O=e.modelPresets?.primary?.model||e.agents?.defaults?.modelPreset||e.agents?.defaults?.model||null;try{for(let[t,n]of Object.entries(e.modelPresets||{}))w.push({preset:t,provider:n.provider||null,model:n.model||null});y=e.agents?.defaults?.modelPreset||Object.keys(e.modelPresets||{})[0]||null}catch{}}catch{}return v=v.trim(),o.NextResponse.json({success:!0,installed:!!a,version:n("VERSION","BINPATH")||null,model:O,models:w,activeModelPreset:y,isNanobot:!0,binPath:a||null,running:/PROC_ACTIVE/.test(n("RUNNING","VERSION")),recentLog:n("LOG","LOGFILE").split("\n").slice(-5).join("\n"),configJson:s||"",envText:v||"",envKeys:[...h],skills:[...g],bundledSkills:[...E],systemPrompt:i,promptFiles:{"PROMPT.md":i,"SOUL.md":l,"USER.md":d,"AGENTS.md":p,"MEMORY.md":u}})}if("set-model-preset"===s){let e=String(a.preset||a.modelPreset||"").trim();if(!e)return o.NextResponse.json({success:!1,error:"preset is required"},{status:400});let t=await (0,r.execCommand)(c,`
P="${$}/config.json"
python3 - "$P" ${h(e)} <<'PYEOF'
import json, sys
path, preset = sys.argv[1], sys.argv[2]
data = json.load(open(path))
if preset not in data.get("modelPresets", {}):
    print(f"PRESET_NOT_FOUND {preset}")
    sys.exit(1)
d = data.setdefault("agents", {}).setdefault("defaults", {})
d["model_preset"] = preset
d["modelPreset"] = preset
json.dump(data, open(path, "w"), indent=2)
print("PRESET_SET", preset)
PYEOF
`,{pool:!1,timeoutMs:3e4}),s=((t.stdout||"")+(t.stderr||"")).trim();if(!/PRESET_SET/.test(s))return o.NextResponse.json({success:!1,error:s||"Failed to set preset",log:n});let i=await O("restart");return o.NextResponse.json({success:!0,activeModelPreset:e,restarted:i.ok,output:s,log:n})}if("save-prompt"===s){let e=String(a.prompt||""),t=a.file||"PROMPT.md",n=Buffer.from(e,"utf8").toString("base64"),s=`mkdir -p "${$}/workspace"
`;return"SOUL.md"===t||"IDENTITY.md"===t?s+=`echo "${n}" | base64 -d > "${$}/workspace/SOUL.md"
echo "${n}" | base64 -d > "${$}/workspace/IDENTITY.md"
`:"USER.md"===t?s+=`echo "${n}" | base64 -d > "${$}/workspace/USER.md"
`:"AGENTS.md"===t?s+=`echo "${n}" | base64 -d > "${$}/workspace/AGENTS.md"
`:"MEMORY.md"===t?s+=`echo "${n}" | base64 -d > "${$}/workspace/MEMORY.md"
`:s+=`echo "${n}" | base64 -d > "${$}/workspace/PROMPT.md"
echo "${n}" | base64 -d > "${$}/prompt.txt"
echo "${n}" | base64 -d > "${$}/workspace/custom_instructions.md"
`,await (0,r.execCommand)(c,s,{pool:!1,timeoutMs:3e4}),!1!==a.restart&&await O("restart"),o.NextResponse.json({success:!0,file:t})}if("uninstall"===s){m&&await (0,d.sdInstanceCtl)(c,"nanobot",m,"stop");let e=m?`if [ -f "${b}" ]; then p=$(cat "${b}"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${b}"; fi; true`:'for p in $(pgrep -f \'[n]anobot gatew\' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr \'\\0\' \' \' < "/proc/$p/cmdline" 2>/dev/null); case "$C" in *".nanobot-"*) continue;; esac; kill -9 $p 2>/dev/null; done; true';await p("stop gateway",e);let t=!1;if(!m)try{let e=await (0,d.listInstances)(c,"nanobot");t=Array.isArray(e)&&e.filter(e=>e.tag&&e.tag!==m).length>0}catch{}let s=m||t&&!i?"":'rm -f "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" /usr/local/bin/nanobot /usr/bin/nanobot 2>/dev/null; pipx uninstall nanobot-ai 2>/dev/null; pipx uninstall nanobot 2>/dev/null; ',a=m?`rm -rf "${$}" 2>/dev/null; [ ! -e "${$}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`:i?`pkill -9 -f '[n]anobot gatew' 2>/dev/null; rm -rf "$HOME/.nanobot-"* 2>/dev/null; ${s}rm -rf "${$}" "$HOME/.cache/nanobot" /tmp/.nb* 2>/dev/null; echo REMOVED_ALL`:`${s}rm -rf "$HOME/.nanobot/venv" "$HOME/.cache/nanobot" "${$}/logs" 2>/dev/null; echo REMOVED_CODE`,r=await p(m?"remove instance (isolated home)":i?"remove nanobot binary & all data":"remove nanobot binary & venv (config kept)",`export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; ${a}`),l=/REMOVED/.test(r.stdout||"");return o.NextResponse.json({success:l,purged:i,output:(r.stdout||"").slice(-500),log:n})}if("install"===s){let e,t=await (0,r.execCommand)(c,v,{pool:!1,timeoutMs:3e4}),s=e=>(t.stdout||"").match(RegExp(`${e}=(.*)`))?.[1]?.trim(),i="1"===s("SUDO");(e=String(s("PY3")||"").match(/(3)\.(\d+)/))&&Number(e[2])>=11||await p("install Python 3.11+",`
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
          S="${i?"sudo -n":""}"
          (command -v apt-get >/dev/null 2>&1 && $S apt-get update -qq 2>/dev/null; $S apt-get install -y python3 python3-venv python3-pip) < /dev/null ||
          (command -v dnf    >/dev/null 2>&1 && { $S dnf install -y python3.11 python3.11-pip 2>/dev/null || $S dnf install -y --allowerasing python3.11 python3.11-pip; }; [ -x /usr/bin/python3.11 ] && ln -sf /usr/bin/python3.11 /usr/local/bin/python3) < /dev/null ||
          (command -v yum    >/dev/null 2>&1 && $S yum install -y python3.11 python3.11-pip) < /dev/null ||
          (command -v zypper >/dev/null 2>&1 && echo 'gpgcheck = 0' >> /etc/zypp/zypp.conf; $S zypper --non-interactive --no-gpg-checks install python311 python311-pip; [ -x /usr/bin/python3.11 ] && ln -sf /usr/bin/python3.11 /usr/local/bin/python3) < /dev/null ||
          (command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed python) < /dev/null ||
          (command -v apk    >/dev/null 2>&1 && $S apk add --no-cache python3 py3-pip py3-virtualenv) < /dev/null ||
          echo PYTHON_PREREQ_SKIPPED`,{timeoutMs:3e5}),await p("ensure python3-venv + pip",`
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
        S="${i?"sudo -n":""}"
        (command -v apt-get >/dev/null 2>&1 && $S apt-get install -y python3-venv python3-pip python3-full 2>/dev/null) < /dev/null || true
        # -devel/headers + a compiler: the HKUDS installer builds wheels from
        # source on several platforms, which fails without them.
        (command -v dnf    >/dev/null 2>&1 && $S dnf install -y python3-pip python3-virtualenv python3-devel gcc 2>/dev/null) < /dev/null || true
        (command -v yum    >/dev/null 2>&1 && $S yum install -y python3-pip python3-devel gcc 2>/dev/null) < /dev/null || true
        (command -v zypper >/dev/null 2>&1 && $S zypper --non-interactive install python3-pip python3-virtualenv python3-devel gcc 2>/dev/null) < /dev/null || true
        (command -v apk    >/dev/null 2>&1 && $S apk add --no-cache py3-pip py3-virtualenv python3-dev gcc musl-dev 2>/dev/null) < /dev/null || true
        (command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed python-pip 2>/dev/null) < /dev/null || true
        true`,{timeoutMs:3e5});let d=await (0,r.execCommand)(c,v,{pool:!1,timeoutMs:3e4});s=e=>(d.stdout||"").match(RegExp(`${e}=(.*)`))?.[1]?.trim();let O=String(s("PY3")||""),w=O.match(/(3)\.(\d+)/);if(!w||11>Number(w[2]))return o.NextResponse.json({success:!1,error:`Python >= 3.11 is required for Nanobot but could not be provisioned on this server (found: ${O||"none"}) — see log.`,log:n});"1"!==s("CURL")&&await p("install curl",`
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
          export DEBIAN_FRONTEND=noninteractive
          S="${i?"sudo -n":""}"
          (command -v apt-get >/dev/null 2>&1 && $S apt-get update -qq 2>/dev/null; $S apt-get install -y curl ca-certificates) < /dev/null ||
          (command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing curl) < /dev/null ||
          (command -v yum    >/dev/null 2>&1 && $S yum install -y curl) < /dev/null ||
          echo PREREQ_SKIPPED`,{timeoutMs:18e4});{let e=0,t=await (0,l.execDetached)(c,'export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"; curl -fsSL https://raw.githubusercontent.com/HKUDS/nanobot/main/scripts/install.sh | sh 2>&1',{pollMs:3e3,timeoutMs:9e5,onLine:t=>{++e<=400&&n.push(t)}});n.push(`$ official installer${0!==t.code?` — exited ${t.code}`:" — finished"}${e>400?` (${e} lines total)`:""}${t.stderr?`
${t.stderr.slice(0,300)}`:""}`)}let y=await (0,r.execCommand)(c,E(),{pool:!1,timeoutMs:15e3}),R=(y.stdout||"").match(/BIN=(.*)/)?.[1]?.trim()||null;if(!R)return o.NextResponse.json({success:!1,error:"Installer finished but nanobot binary was not found. See log.",log:n});let S=h(R),N=a&&a.env||{},P=a&&a.settings||{},_={OPENROUTER_API_KEY:"openrouter",OPENAI_API_KEY:"openai",ANTHROPIC_API_KEY:"anthropic",CUSTOM_LLM_API_KEY:"custom"},k=P.model||P.default_model||N.MODEL||N.NANOBOT_MODEL||N.DEFAULT_MODEL||null,T=Object.entries(N).map(([e,t])=>({k:e,v:t,p:_[e]})).find(e=>e.p&&e.v),A={},x=String(N.OPENAI_BASE_URL||N.OPENAI_API_BASE||"").trim();if(T){let e={apiKey:T.v};"custom"===T.p&&x&&(e.api_base=x),A.providers={[T.p]:e},k&&(A.modelPresets={primary:{provider:T.p,model:k,maxTokens:8192,contextWindowTokens:65536}},A.agents={defaults:{model_preset:"primary",modelPreset:"primary"}})}else k&&(A.modelPresets={primary:{model:k}});m&&g&&(A.channels=A.channels||{},A.channels.websocket={...A.channels.websocket||{},port:g+1});let I=N.TELEGRAM_BOT_TOKEN||N.TELEGRAM_TOKEN,M=N.TELEGRAM_ALLOWED_USERS?N.TELEGRAM_ALLOWED_USERS.split(",").map(e=>e.trim()).filter(Boolean):null;I&&(A.channels=A.channels||{},A.channels.telegram={enabled:!0,token:I,...M?{allowFrom:M}:{}});let L={..."object"==typeof a.configJson&&a.configJson||{},...A},C=Object.entries(N).filter(([e,t])=>e&&null!=t&&""!==String(t).trim()),D=u(C.map(([e,t])=>`${e}=${t}`).join("\n"));u(JSON.stringify(L)),await p(`merge ${m?`~/.nanobot-${m}`:"~/.nanobot"}/config.json`,[`export NB_HOME="${$}"; mkdir -p "${$}"`,C.length?`echo '${D}' | base64 -d > "${$}/.env"; chmod 600 "${$}/.env"`:"true",`echo '${u(JSON.stringify(L))}' | base64 -d > /tmp/.nb-new.json`,"cat > /tmp/.nb-merge.py <<'PYEOF'\nimport json, os, sys\nhome = os.environ.get('NB_HOME') or os.path.expanduser('~/.nanobot')\npath = os.path.join(home, 'config.json')\nnew = json.load(open(sys.argv[1]))\ncur = {}\nif os.path.exists(path):\n    try: cur = json.load(open(path))\n    except Exception: cur = {}\ndef deep_merge(a, b):\n    for k, v in b.items():\n        if isinstance(v, dict) and isinstance(a.get(k), dict): deep_merge(a[k], v)\n        else: a[k] = v\n    return a\njson.dump(deep_merge(cur, new), open(path, \"w\"), indent=2)\nprint('CONFIG_MERGED')\nPYEOF",`(command -v python3 >/dev/null 2>&1 && python3 /tmp/.nb-merge.py /tmp/.nb-new.json || cp /tmp/.nb-new.json "${$}/config.json")`,"rm -f /tmp/.nb-new.json /tmp/.nb-merge.py\necho NB_CFG_MERGED"].join("\n"),{timeoutMs:6e4}),(a.plugins||[]).includes("telegram")&&await p("enable telegram plugin",`PATH="$(dirname ${S}):$PATH" ${S} plugins enable telegram 2>&1 | tail -3 || true`,{timeoutMs:12e4}),await p("start gateway",`mkdir -p "${$}/logs" "${$}/workspace"; rm -f "${b}"
NBSTARTSCAN=1; setsid nohup ${S} gateway${GW_FLAGS} >> "${$}/logs/gateway.log" 2>&1 < /dev/null & echo $! > "${b}"
sleep 4
REAL=$(NBSTARTSCAN=1; for p in $(pgrep -f '[n]anobot' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); case "$C" in *NBSTARTSCAN*) continue;; esac; case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac; case "$C" in *"${$}"*) echo "$p"; break;; esac; done); [ -n "$REAL" ] && echo "$REAL" > "${b}"; ${f($,b,m)}`,{timeoutMs:9e4});let B=await (0,r.execCommand)(c,f($,b,m),{pool:!1,timeoutMs:3e4}),j=/PROC_ACTIVE/.test(B.stdout||"");return o.NextResponse.json({success:j,running:j,startMethod:"process",error:j?null:"Gateway did not stay running — check ~/.nanobot/logs/gateway.log on the server.",log:n})}if("reconfigure"===s){let e=a&&a.env||{},t={OPENROUTER_API_KEY:"openrouter",OPENAI_API_KEY:"openai",ANTHROPIC_API_KEY:"anthropic",CUSTOM_LLM_API_KEY:"custom"},s=a.settings&&(a.settings.model||a.settings.default_model)||e.MODEL||e.NANOBOT_MODEL||e.DEFAULT_MODEL||null,i=Object.entries(e).map(([e,n])=>({k:e,v:n,p:t[e]})).find(e=>e.p&&e.v),l={},d=String(e.OPENAI_BASE_URL||e.OPENAI_API_BASE||"").trim();if(i){let e={apiKey:i.v};"custom"===i.p&&d&&(e.api_base=d),l.providers={[i.p]:e},s&&(l.modelPresets={primary:{provider:i.p,model:s,maxTokens:8192,contextWindowTokens:65536}},l.agents={defaults:{model_preset:"primary",modelPreset:"primary"}})}else s&&(l.modelPresets={primary:{model:s}});d&&(e.CUSTOM_LLM_BASE_URL=d),m&&g&&(l.channels=l.channels||{},l.channels.websocket={...l.channels.websocket||{},port:g+1});let h=e.TELEGRAM_BOT_TOKEN||e.TELEGRAM_TOKEN,f=e.TELEGRAM_ALLOWED_USERS?e.TELEGRAM_ALLOWED_USERS.split(",").map(e=>e.trim()).filter(Boolean):null;h&&(l.channels=l.channels||{},l.channels.telegram={enabled:!0,token:h,...f?{allowFrom:f}:{}},await (0,r.execCommand)(c,'export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; command -v nanobot >/dev/null 2>&1 && nanobot plugins enable telegram 2>/dev/null || true',{pool:!1,timeoutMs:3e4}));let v=Object.entries(e).filter(([e,t])=>e&&null!=t&&""!==String(t).trim()),b=u(JSON.stringify(l)),E=u(v.map(([e,t])=>`${e}=${t}`).join("\n")),w=await p(`merge ${m?`~/.nanobot-${m}`:"~/.nanobot"}/config.json`,[`export NB_HOME="${$}"; mkdir -p "${$}"`,`echo '${b}' | base64 -d > /tmp/.nb-cfg-new.json`,v.length?`echo '${E}' | base64 -d > "${$}/.env"; chmod 600 "${$}/.env"`:"true",`cat > /tmp/.nb-merge.py <<'PYEOF'
import json, os, sys
home = os.environ.get('NB_HOME') or os.path.expanduser('~/.nanobot')
p = home.rstrip('/') + '/config.json'
new = json.load(open(sys.argv[1]))
cur = {}
if os.path.exists(p):
    try: cur = json.load(open(p))
    except Exception: cur = {}
# Remember the previously active provider so a save that only changes MODEL
# (no new provider key) still keeps a valid provider reference.
old_active = cur.get('agents', {}).get('defaults', {}).get('model_preset') or cur.get('agents', {}).get('defaults', {}).get('modelPreset')
old_provider = cur.get('modelPresets', {}).get(old_active, {}).get('provider') if old_active else None
if not old_provider:
    old_provider = next(iter(cur.get('providers', {})), None)
# Replace (not deep-merge) the provider/model/agent sections so stale providers
# (e.g. openrouter) don't linger when the user switched to custom.
for k in ('providers', 'modelPresets', 'agents'):
    if k in new:
        cur.pop(k, None)
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, new)
for pr in (cur.get('modelPresets') or {}).values():
    if isinstance(pr, dict) and not pr.get('provider') and old_provider:
        pr['provider'] = old_provider
json.dump(cur, open(p, 'w'), indent=2)
print('MERGED')
PYEOF`,`(command -v python3 >/dev/null 2>&1 && python3 /tmp/.nb-merge.py /tmp/.nb-cfg-new.json || cp /tmp/.nb-cfg-new.json "${$}/config.json")`,"rm -f /tmp/.nb-cfg-new.json /tmp/.nb-merge.py\necho RECONFIGURED"].join("\n"),{timeoutMs:3e4});if(!/RECONFIGURED/.test((w.stdout||"")+(w.stderr||"")))return o.NextResponse.json({success:!1,error:"Failed to write config",log:n});let y=await O("restart");return o.NextResponse.json({success:y.ok,restarted:y.ok,startMethod:y.ok?"process":null,error:y.ok?null:y.out||"gateway did not start after reconfigure",log:n})}if("save-config"===s){let e=String(a.configJson??"");if(!e.trim())return o.NextResponse.json({success:!1,error:"config.json content is empty"},{status:400});await (0,r.execCommand)(c,`
        cp "${$}/config.json" "${$}/config.json.bak-$(date +%s)" 2>/dev/null || true
        echo '${u(e)}' | base64 -d > "${$}/config.json.new"
        mv "${$}/config.json.new" "${$}/config.json"
        echo CONFIG_SAVED`,{pool:!1,timeoutMs:3e4});let t=!1,n=!1;if(a.restart){let e=await O("restart");if(t=e.ok,!e.ok){let e=await (0,r.execCommand)(c,`BAK="$(ls -1t "${$}"/config.json.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${$}/config.json" && echo ROLLED_BACK=$BAK || echo NO_BACKUP`,{pool:!1,timeoutMs:3e4});if(/ROLLED_BACK/.test(e.stdout||""))return n=!0,await O("restart"),o.NextResponse.json({success:!0,restarted:!0,rolledBack:!0})}}return o.NextResponse.json({success:!0,restarted:t,rolledBack:n})}if("backups"===s){let e=((await (0,r.execCommand)(c,`ls -1t "${$}"/config.json.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,{pool:!1,timeoutMs:3e4})).stdout||"").split("\n").filter(Boolean).map(e=>{let t=e.split("|");return{name:t[0],date:t[1]||"",size:Number(t[2])||0}});return o.NextResponse.json({success:!0,backups:e})}if("restore-backup"===s){let e=String(a.name||a.backup||"");if(!/^config\.json\.bak-[0-9]+$/.test(e))return o.NextResponse.json({success:!1,error:"Invalid backup name"},{status:400});let t=await (0,r.execCommand)(c,`[ -f "${$}/${e}" ] && cp "${$}/${e}" "${$}/config.json" && echo RESTORED || echo NOT_FOUND`,{pool:!1,timeoutMs:3e4}),n=!1;return/RESTORED/.test(t.stdout||"")&&(n=(await O("restart")).ok),o.NextResponse.json({success:/RESTORED/.test(t.stdout||""),restarted:n})}if("pairing-approve"===s){String(a.platform||"auto").trim();let e=String(a.code||"").trim();if(!e)return o.NextResponse.json({success:!1,error:"Pairing code is required"},{status:400});let t=await (0,r.execCommand)(c,`
export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"
P="${$}/pairing.json"
BP="$( (command -v nanobot || which nanobot) 2>/dev/null || echo $HOME/.local/bin/nanobot )"
if [ ! -f "$P" ]; then echo NO_STORE; exit 0; fi
python3 - "$P" ${h(e)} <<'PYEOF'
import json, sys, os
path, code = sys.argv[1], sys.argv[2]
data = json.load(open(path))
pending = data.get("pending", {})
info = pending.pop(code, None)
if info is None:
    # try approved too (idempotent re-approve)
    for ch, users in data.get("approved", {}).items():
        if isinstance(users, list) and code in users:
            print("ALREADY_APPROVED", ch)
            sys.exit(0)
    print("CODE_NOT_FOUND")
    sys.exit(1)
channel = str(info.get("channel", "telegram"))
sender = str(info.get("sender_id", ""))
data.setdefault("approved", {}).setdefault(channel, [])
if sender and sender not in data["approved"][channel]:
    data["approved"][channel].append(sender)
json.dump(data, open(path, "w"), indent=2)
print("APPROVED", channel, sender)
PYEOF
      `,{pool:!1,timeoutMs:3e4}),s=((t.stdout||"")+(t.stderr||"")).trim(),i=/APPROVED|ALREADY_APPROVED/.test(s);return o.NextResponse.json({success:i,output:s||"Pairing command executed",approved:/APPROVED/.test(s),log:n})}if("pairing-list"===s){let e=(await (0,r.execCommand)(c,`
P="${$}/pairing.json"
if [ ! -f "$P" ]; then echo NO_STORE; exit 0; fi
python3 - "$P" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
for code, info in data.get("pending", {}).items():
    print(f"PENDING {code} {info.get('channel','telegram')} {info.get('sender_id','')}")
for ch, users in data.get("approved", {}).items():
    for u in users:
        print(f"APPROVED {ch} {u}")
PYEOF
      `,{pool:!1,timeoutMs:2e4})).stdout||"",t=[];for(let n of e.split("\n")){let e=n.match(/^PENDING\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);e&&t.push({code:e[1],platform:e[2]||"telegram",sender:e[3]||""})}return o.NextResponse.json({success:!0,pending:t,raw:e.slice(-1e3)})}if("gateway"===s){let e=["start","stop","restart"].includes(a.op)?a.op:"status",t=await O(e);return o.NextResponse.json({success:!1!==t.ok,active:t.active??t.ok,output:t.out||"",op:e})}if("logs"===s){let e=Number(a.cursor||0),t=Math.min(Number(a.lines||300),1e3),n=`
LOG=""
for f in "${$}/logs/gatew""ay.log" "${$}-gatew""ay.log" "${$}/logs/webui.log"; do
  [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break
done
if [ -z "$LOG" ]; then echo "SIZE=0"; echo "===DATA==="; exit 0; fi
SZ=$(wc -c < "$LOG")
echo "SIZE=$SZ"
echo "===DATA==="
if [ ${e} -gt 0 ] && [ ${e} -le $SZ ]; then tail -c +$((cursor + 1)) "$LOG"; else tail -n ${t} "$LOG"; fi
`,s=(await (0,r.execCommand)(c,n,{pool:!1,timeoutMs:45e3})).stdout||"",i=s.indexOf("===DATA===");return o.NextResponse.json({success:!0,size:Number(s.match(/SIZE=(\d+)/)?.[1]||0),data:i>=0?s.slice(i+10):""})}if("health"===s){let e=`
PROBE=$( ${f($,b,m)} )
ALIVE=0; echo "$PROBE" | grep -qx PROC_ACTIVE && ALIVE=1
# Uptime must come from the RESOLVED pid — the pidfile alone can be stale, which
# used to report uptime 0 for a gateway that had been up for days.
PID=$(echo "$PROBE" | sed -n 's/^GWPID=//p' | head -1)
echo "ALIVE=$ALIVE"
UP=0
case "$PID" in ''|systemd:*) ;; *) UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ');; esac
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "${$}/logs/gatew""ay.log" "${$}-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break; done
if [ -n "$LOGL" ]; then
  if tail -n 300 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
    TG=error
  fi
fi
echo "TG=$TG"
`,t=(await (0,r.execCommand)(c,e,{pool:!1,timeoutMs:45e3})).stdout||"",n=e=>(t.match(RegExp(`${e}=([^\\n]*)`))||[])[1]?.trim();return o.NextResponse.json({success:!0,alive:"1"===n("ALIVE"),uptimeSec:Number(n("UPTIME_SEC")||0),telegram:n("TG")||"unknown"})}if("skills"===s){let e=a.op,t=await (0,r.execCommand)(c,E(),{pool:!1,timeoutMs:15e3}),n=(t.stdout||"").match(/BIN=(.*)/)?.[1]?.trim(),s=n?h(n):"nanobot",i='export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"';if("remove"===e){let e=String(a.name||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(e))return o.NextResponse.json({success:!1,error:"Invalid skill/plugin name"},{status:400});await (0,r.execCommand)(c,`${i}; ${s} plugins disable ${h(e)} 2>/dev/null; rm -rf "${$}/workspace/skills/${e}" 2>/dev/null; true`,{pool:!1,timeoutMs:3e4});let t=await O("restart");return o.NextResponse.json({success:!0,restarted:t.ok,log:[`Removed skill/plugin ${e}`]})}if("install"===e){let e=String(a.id||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(e))return o.NextResponse.json({success:!1,error:"Invalid skill id"},{status:400});let t="";if(["telegram","discord","slack","matrix","feishu","dingtalk","email","langfuse","azure","bedrock","msteams","qq","signal","wecom","weixin","whatsapp","api","olostep","napcat","mochat","mattermost"].includes(e.toLowerCase())){let n=await (0,r.execCommand)(c,`${i}; ${s} plugins enable ${e.toLowerCase()} 2>&1`,{pool:!1,timeoutMs:12e4});t=n.stdout||n.stderr}else await (0,r.execCommand)(c,`mkdir -p "${$}/workspace/skills"; cd "${$}/workspace/skills"; git clone --depth 1 "${e}" 2>/dev/null || (mkdir -p "${e.replace(/[^a-zA-Z0-9_-]/g,"_")}" && echo '# ${e}' > "${e.replace(/[^a-zA-Z0-9_-]/g,"_")}/SKILL.md")`,{pool:!1,timeoutMs:12e4}),t=`Installed custom skill ${e}`;let n=await O("restart");return o.NextResponse.json({success:!0,restarted:n.ok,output:t})}if("install-content"===e){let e=String(a.name||a.id||"").trim(),t=e.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"").slice(0,64)||"custom-skill",n=String(a.content||"").trim();n||(n=`# ${e}

Skill definition for ${e}.
`);let s=Buffer.from(n,"utf8").toString("base64");await (0,r.execCommand)(c,`${i}; mkdir -p "${$}/workspace/skills/${t}" "${$}/skills/${t}"; printf '%s' "${s}" | base64 -d | tee "${$}/workspace/skills/${t}/SKILL.md" > "${$}/skills/${t}/SKILL.md"`,{pool:!1,timeoutMs:3e4});let l=await O("restart");return o.NextResponse.json({success:!0,restarted:l.ok,output:`Installed skill "${e}" with full content`})}return o.NextResponse.json({success:!1,error:`Unknown skills op: ${e}`},{status:400})}return o.NextResponse.json({success:!1,error:`Unknown action: ${s}`},{status:400})}catch(e){return c.logger.error("[nanobot-agent] action failed:",e.message),o.NextResponse.json({success:!1,error:e.message},{status:500})}}e.s(["POST",0,m]),n()}catch(e){n(e)}},!1),42822,e=>{"use strict";var t=e.i(8970),n=e.i(74017),o=e.i(96250),s=e.i(59756),a=e.i(61916),r=e.i(74677),i=e.i(69741),l=e.i(16795),c=e.i(87718),d=e.i(95169),p=e.i(47587),u=e.i(66012),m=e.i(70101),$=e.i(26937),h=e.i(10372),f=e.i(93695);e.i(52474);var v=e.i(5232);let g=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/agents/nanobot/route",pathname:"/api/agents/nanobot",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/agents/nanobot/route.js",nextConfigOutput:"",userland:()=>e.r(11364),...{}}),{workAsyncStorage:b,workUnitAsyncStorage:E,serverHooks:O}=g;async function w(e,t,o){o.requestMeta&&(0,s.setRequestMeta)(e,o.requestMeta),g.isDev&&(0,s.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let b="/api/agents/nanobot/route";b=b.replace(/\/index$/,"")||"/";let E=await g.prepare(e,t,{srcPage:b,multiZoneDraftMode:!1});if(!E)return t.statusCode=400,t.end("Bad Request"),null==o.waitUntil||o.waitUntil.call(o,Promise.resolve()),null;let{buildId:O,deploymentId:w,params:y,nextConfig:R,parsedUrl:S,isDraftMode:N,prerenderManifest:P,routerServerContext:_,isOnDemandRevalidate:k,revalidateOnlyGenerated:T,resolvedPathname:A,clientReferenceManifest:x,serverActionsManifest:I}=E,M=(0,i.normalizeAppPath)(b),L=!!(P.dynamicRoutes[M]||P.routes[A]),C=async()=>((null==_?void 0:_.render404)?await _.render404(e,t,S,!1):t.end("This page could not be found"),null);if(L&&!N){let e=!!P.routes[A],t=P.dynamicRoutes[M];if(t&&!1===t.fallback&&!e){if(R.adapterPath)return await C();throw new f.NoFallbackError}}let D=null;!L||g.isDev||N||(D="/index"===(D=A)?"/":D);let B=!0===g.isDev||!L,j=L&&!B;I&&x&&(0,r.setManifestsSingleton)({page:b,clientReferenceManifest:x,serverActionsManifest:I});let G=e.method||"GET",U=(0,a.getTracer)(),H=U.getActiveScopeSpan(),K=!!(null==_?void 0:_.isWrappedByNextServer),F=!!(0,s.getRequestMeta)(e,"minimalMode"),Y=(0,s.getRequestMeta)(e,"incrementalCache")||await g.getIncrementalCache(e,R,P,F);null==Y||Y.resetRequestCache(),globalThis.__incrementalCache=Y;let q={params:y,previewProps:P.preview,renderOpts:{experimental:{authInterrupts:!!R.experimental.authInterrupts,useCacheTimeout:R.experimental.useCacheTimeout},cacheComponents:!!R.cacheComponents,validationLevel:R.experimental.instantInsights.validationLevel,supportsDynamicResponse:B,incrementalCache:Y,hmrRefreshHash:(0,s.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:R.cacheLife,staticPageGenerationTimeout:R.staticPageGenerationTimeout,waitUntil:o.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,o,s)=>g.onRequestError(e,t,o,s,_)},sharedContext:{buildId:O,deploymentId:w}},W=new l.NodeNextRequest(e),z=new l.NodeNextResponse(t),V=c.NextRequestAdapter.fromNodeNextRequest(W,(0,c.signalFromNodeResponse)(t)),Z=async({previousCacheEntry:n})=>{try{if(!F&&k&&T&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await g.handle(V,q);e.fetchMetrics=q.renderOpts.fetchMetrics;let a=q.renderOpts.pendingWaitUntil;a&&o.waitUntil&&(o.waitUntil(a),a=void 0);let r=q.renderOpts.collectedTags;if(!L)return await (0,u.sendResponse)(W,z,s,a),null;{let e=await s.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(s.headers);r&&(t[h.NEXT_CACHE_TAGS_HEADER]=r),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==q.renderOpts.collectedRevalidate&&!(q.renderOpts.collectedRevalidate>=h.INFINITE_CACHE)&&q.renderOpts.collectedRevalidate,o=void 0===q.renderOpts.collectedExpire||q.renderOpts.collectedExpire>=h.INFINITE_CACHE?!1!==n&&n>0?R.expireTime:void 0:q.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:o}}}}catch(t){throw(null==n?void 0:n.isStale)&&await g.onRequestError(e,t,{routerKind:"App Router",routePath:b,routeType:"route",revalidateReason:(0,p.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:k})},!1,_),t}},J=async(s,r)=>{try{var i,l;let s=await g.handleResponse({req:e,nextConfig:R,cacheKey:D,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:P,isRoutePPREnabled:!1,isOnDemandRevalidate:k,revalidateOnlyGenerated:T,responseGenerator:Z,waitUntil:o.waitUntil,isMinimalMode:F});if(!L)return;if((null==s||null==(i=s.value)?void 0:i.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==s||null==(l=s.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});F||t.setHeader("x-nextjs-cache",k?"REVALIDATED":s.isMiss?"MISS":s.isStale?"STALE":"HIT"),N&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let a=(0,m.fromNodeOutgoingHttpHeaders)(s.value.headers);F&&L||a.delete(h.NEXT_CACHE_TAGS_HEADER),!s.cacheControl||t.getHeader("Cache-Control")||a.get("Cache-Control")||a.set("Cache-Control",(0,$.getCacheControlHeader)(s.cacheControl)),await (0,u.sendResponse)(W,z,new Response(s.value.body,{headers:a,status:s.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await g.onRequestError(e,t,{routerKind:"App Router",routePath:M,routeType:"route",revalidateReason:(0,p.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:k})},!1,_),L)throw t;await (0,u.sendResponse)(W,z,new Response(null,{status:500}));return}finally{(()=>{if(!s)return;let e=t.statusCode;s.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(s.setStatus({code:a.SpanStatusCode.ERROR}),s.setAttribute("error.type",e.toString()));let n=U.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let o=n.get("next.route")||M,i=`${G} ${o}`;s.setAttributes({"next.route":o,"http.route":o,"next.span_name":i}),s.updateName(i),r&&r!==s&&(r.setAttribute("http.route",o),r.updateName(i))})()}};if(K&&H)await J(H,void 0);else{let t=U.getActiveScopeSpan();await U.withPropagatedContext(e.headers,()=>U.trace(d.BaseServerSpan.handleRequest,{spanName:`${G} ${b}`,kind:a.SpanKind.SERVER,attributes:{"http.method":G,"http.target":e.url}},e=>J(e,t)),void 0,!K)}}e.s(["handler",0,w,"patchFetch",0,function(){return(0,o.patchFetch)({workAsyncStorage:b,workUnitAsyncStorage:E})},"routeModule",0,g,"serverHooks",0,O,"workAsyncStorage",0,b,"workUnitAsyncStorage",0,E])}];

//# sourceMappingURL=_1xsn0jy._.js.map