module.exports=[86724,e=>e.a(async(t,o)=>{try{var n=e.i(89171),s=e.i(23667),a=e.i(80533),l=e.i(47185),r=e.i(43185),i=e.i(69683),c=e.i(51631),p=e.i(67723),u=t([a,l,i,p]);[a,l,i,p]=u.then?(await u)():u;let $='openclaw-gatew""ay',w=`
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v openclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.openclaw/openclaw.json" ] && CFG=1
echo "CONFIG=$CFG"
NODE=NONE; command -v node >/dev/null 2>&1 && NODE=$(node --version 2>/dev/null | cut -c1-20)
echo "NODE=$NODE"
PROC=0; pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null 2>&1 && PROC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active ${$} 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active ${$} 2>/dev/null | grep -qx active && SSVC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q 18789 || command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q 18789) && PORT=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
INITD=0; ps -p 1 -o comm= 2>/dev/null | grep -qx systemd && INITD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
GZP=0; command -v gzip >/dev/null 2>&1 && GZP=1
PROCP=0; command -v pgrep >/dev/null 2>&1 && PROCP=1
TARP=0; command -v tar >/dev/null 2>&1 && TARP=1
echo "PROC=$PROC"; echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PORT=$PORT"
echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"; echo "CURL=$CURLP"; echo "TAR=$TARP"; echo "GZIP=$GZP"; echo "PROCP=$PROCP"
`;async function d(e){try{let t=await (0,s.getServerSession)(a.authOptions);if(!t)return n.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let o=await e.json(),{connectionId:l,action:i,config:c={},purge:p=!1}=o;if((!l||!i)&&"job"!==i)return n.NextResponse.json({success:!1,error:"Missing connectionId or action"},{status:400});if("job"===i)return(0,r.dispatchWithLiveLogs)(o,()=>({}));return(0,r.dispatchWithLiveLogs)(o,(e,o)=>m(e,t,o))}catch(e){return c.logger.error("[agents/openclaw] POST failed:",e?.message),n.NextResponse.json({success:!1,error:e?.message||"Request failed"},{status:500})}}async function m(e,t,o=[]){try{let{connectionId:t,action:s,config:a={},purge:r=!1}=e,c=await (0,l.getSshConfig)(t),u=async(e,t,n={})=>{let s=await (0,l.execCommand)(c,t,{pool:!1,timeoutMs:6e4,...n}),a=((s.stdout||"")+(s.stderr||"")).trim();return o.push(`$ ${e}${a?`
${a.slice(0,2500)}`:""}`),s},d=e=>Buffer.from(String(e),"utf8").toString("base64"),m=(0,p.parseInst)(e),f=(0,p.homeDir)("openclaw",m),v=(0,p.instancePort)("openclaw",m),h=`${f}/daemon.pid`,E=()=>`p="${f}/install/bin/openclaw"; [ ! -x "$p" ] && p="$(export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"; command -v openclaw 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`,g=async e=>{if(m&&await (0,p.sdAvailable)(c)){await (0,p.writeInstanceEnv)(c,f,{OC_PORT:v}),await (0,p.ensureInstanceUnit)(c,"openclaw",(0,p.gatewayUnit)("openclaw",{description:"OpenClaw gateway",envLines:["EnvironmentFile=-%h/.openclaw-%i/instance.env","EnvironmentFile=-%h/.openclaw-%i/.env","Environment=OPENCLAW_STATE_DIR=%h/.openclaw-%i","Environment=OPENCLAW_CONFIG_PATH=%h/.openclaw-%i/openclaw.json","Environment=OPENCLAW_LOG_DIR=%h/.openclaw-%i/logs","Environment=PATH=%h/.openclaw-%i/install/bin:%h/.openclaw/local/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin"],execStart:"/bin/sh -c 'exec \"$([ -x %h/.openclaw-%i/install/bin/openclaw ] && echo %h/.openclaw-%i/install/bin/openclaw || command -v openclaw || echo %h/.openclaw/local/bin/openclaw)\" gatew''ay --port \"$OC_PORT\"'",logFile:"%h/.openclaw-%i/logs/gateway.log"}));let t=await (0,p.sdInstanceCtl)(c,"openclaw",m,e);if(t)return t}if(!m&&await (0,p.sdAvailable)(c)){let t=(await (0,l.execCommand)(c,`export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; systemctl --user list-unit-files "${$}*" 2>/dev/null | grep -qi "${$}" && echo UNIT_SCOPE=user; systemctl list-unit-files "${$}*" 2>/dev/null | grep -qi "${$}" && echo UNIT_SCOPE=system; echo PROBE_DONE`,{pool:!1,timeoutMs:15e3})).stdout||"",o=/UNIT_SCOPE=user/.test(t)?"user":/UNIT_SCOPE=system/.test(t)?"system":null;if(o){let t="user"===o?"systemctl --user":"systemctl",n="system"===o?"sudo -n ":"",s='export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; ',a=await (0,l.execCommand)(c,`${s}${n}${t} ${e} ${$} 2>&1 | tail -5; echo "SD_DONE";`,{pool:!1,timeoutMs:9e4}),r=(a.stdout||"")+(a.stderr||"");if(/SD_DONE/.test(r)&&!/Unknown|not-found|No such file/i.test(r)){let e=await (0,l.execCommand)(c,`${s}${n}${t} is-active ${$} 2>/dev/null | grep -qx active && echo ACTIVE || echo INACTIVE`,{pool:!1,timeoutMs:15e3});return{ok:!0,active:/ACTIVE/.test(e.stdout||""),out:r.slice(-400)}}}}let t=await (0,l.execCommand)(c,`${E()} ; echo "SYSTEMD=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)"`,{pool:!1,timeoutMs:15e3}),o=(t.stdout||"").match(/BIN=(.*)/)?.[1]?.trim();if(!o)return{ok:!1,out:"openclaw binary not found"};/SYSTEMD=1/.test(t.stdout||"");let n=JSON.stringify(o),s=m?`export OPENCLAW_STATE_DIR="${f}"; export OPENCLAW_CONFIG_PATH="${f}/openclaw.json"; export OPENCLAW_LOG_DIR="${f}/logs"`:"",a=v?` --port ${v}`:"",r=m?`"${f}/logs/gateway.log"`:'"$HOME/.openclaw/logs/gatew""ay.log"',i=['export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null','export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"',`set -a; [ -f "${f}/.env" ] && . "${f}/.env"; set +a`,s||null].filter(Boolean).join("; ");if("status"===e){let e=await (0,l.execCommand)(c,`${i}; res=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && res=1; echo "PROC=$res"`,{pool:!1,timeoutMs:3e4});return{ok:!0,active:/PROC=1/.test(e.stdout||"")}}if("stop"===e)return(0,l.execCommand)(c,`${i}; if [ -f "${h}" ]; then kill $(cat "${h}") 2>/dev/null; sleep 1; kill -9 $(cat "${h}") 2>/dev/null; fi; rm -f "${h}"; echo GW_STOPPED`,{pool:!1,timeoutMs:6e4}).then(e=>({ok:/GW_STOPPED/.test(e.stdout||""),out:((e.stdout||"")+(e.stderr||"")).slice(-400)}));"restart"===e&&await g("stop");let u=`${i}; mkdir -p "${f}/logs"; setsid nohup ${n} gateway${a} >> ${r} 2>&1 < /dev/null & echo $! > "${h}"; sleep 4; if kill -0 $(cat "${h}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; tail -8 "${f}/logs/gateway.log" 2>/dev/null; fi`;return(0,l.execCommand)(c,u,{pool:!1,timeoutMs:12e4}).then(e=>({ok:/GW_UP/.test(e.stdout||""),out:(e.stdout||"").slice(-400)}))};if("status"===s){let e=await (0,l.execCommand)(c,w,{pool:!0,timeoutMs:3e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim(),o="SET"===t("BIN");return n.NextResponse.json({success:!0,installed:o,version:o?t("VERSION"):null,running:"1"===t("USVC")||"1"===t("SSVC")||"1"===t("PROC"),hasConfig:"1"===t("CONFIG"),prereqs:{curl:"1"===t("CURL"),tar:"1"===t("TAR"),node:t("NODE"),systemd:"1"===t("SYSTEMD"),passwordlessSudo:"1"===t("SUDO")}})}if("instances"===s){let e=await (0,p.listInstances)(c,"openclaw");return n.NextResponse.json({success:!0,instances:e})}if("spawn-instance"===s){let e=String(a&&a.tag||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,24);if(!e)return n.NextResponse.json({success:!1,error:"Instance tag is required"},{status:400});let t=await (0,p.cloneDefaultHome)(c,"openclaw",e,["openclaw.json",".env","workspace/PROMPT.md","workspace/SOUL.md","workspace/IDENTITY.md","workspace/USER.md","workspace/AGENTS.md","workspace/MEMORY.md","prompt.txt","SYSTEM_PROMPT.md"]);if(!t.ok)return n.NextResponse.json({success:!1,error:"Failed to clone openclaw instance home"});let o=null;if(!t.existed){let t=await (0,p.copyInstanceBin)(c,"openclaw",e,f);o=t.err||(t.copied?"own binary copied":t.already?"own binary already present":"no source to copy")}let s=await g("start");return n.NextResponse.json({success:!0,instance:e,existed:t.existed,started:s.ok,output:t.existed?`Instance "${e}" already existed — gateway ${s.ok?"running":"not started"}.`:`Instance "${e}" spawned and ${s.ok?"running":"failed to start"}. ${o}. Remember: give it its OWN bot token (reconfigure → env) so instances don't fight over the same Telegram bot.`})}if("details"===s){let e=`
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
BIN="$(command -v openclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${f}/openclaw.json" 2>/dev/null || true
echo "===RUNNING==="
res=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && res=1
if [ "$res" = 0 ] && [ -n "${m}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active openclaw-gatew""ay@${m} 2>/dev/null | grep -qx active && res=1
fi
echo "PROC=$res"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===MODEL==="
[ -f "${f}/openclaw.json" ] && grep -oE '"(defaultModel|model)"[[:space:]]*:[[:space:]]*"[^"]+"' "${f}/openclaw.json" 2>/dev/null | head -1 | cut -d'"' -f4
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===SKILLS==="
[ -d "${f}/skills" ] && ls -1 "${f}/skills" 2>/dev/null | grep -v '^\\.' || true
[ -d "${f}/workspace/skills" ] && ls -1 "${f}/workspace/skills" 2>/dev/null | grep -v '^\\.' || true
echo "===SKILLSCLI==="
# OpenClaw bundles its own skill catalog (openclaw-bundled/extra) — list via CLI
[ -n "$BIN" ] && "$BIN" skills list 2>/dev/null || true
echo "===PROMPT_B64==="
{ base64 < "${f}/workspace/PROMPT.md" || base64 < "${f}/prompt.txt" || base64 < "${f}/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${f}/workspace/SOUL.md" || base64 < "${f}/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "${f}/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "${f}/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${f}/workspace/MEMORY.md" || base64 < "${f}/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===ENV_B64==="
base64 < "${f}/.env" 2>/dev/null || true
echo "===ENVKEYS==="
[ -f "${f}/.env" ] && grep -oE '^[A-Z_][A-Z0-9_]*' "${f}/.env" 2>/dev/null | sort -u | head -50
`,t=(await (0,l.execCommand)(c,e,{pool:!0,timeoutMs:6e4})).stdout||"",o=(e,o)=>{let n=`===${e}===`,s=t.indexOf(n);if(s<0)return"";let a=s+n.length;if(!o)return t.slice(a).trim();let l=`===${o}===`,r=t.indexOf(l,a);return(r>=0?t.slice(a,r):t.slice(a)).trim()},s="";try{s=Buffer.from(o("CONFIG_B64","RUNNING"),"base64").toString("utf8")}catch{}let a="";try{a=Buffer.from(o("ENV_B64","ENVKEYS"),"base64").toString("utf8")}catch{}let r=o("BINPATH","SKILLS"),i=/USVC=1|SSVC=1|PROC=1/.test(o("RUNNING","VERSION")),p=o("ENVKEYS").split("\n").map(e=>e.trim()).filter(Boolean),u=new Set(o("SKILLS","SKILLSCLI").split("\n").map(e=>e.trim()).filter(Boolean));for(let e of o("SKILLSCLI","PROMPT_B64").split("\n")){if(!e.includes("│"))continue;let t=e.split("│").map(e=>e.trim());if(t.length<4||!t[1]||!t[2]||"Status"===t[1])continue;let o=t[2].replace(/^[^A-Za-z0-9]+/,"").trim();o&&/^[a-zA-Z0-9][\w.-]*$/.test(o)&&"skill"!==o.toLowerCase()&&u.add(o)}let d="";try{d=Buffer.from(o("PROMPT_B64","SOUL_B64"),"base64").toString("utf8")}catch{}let $="";try{$=Buffer.from(o("SOUL_B64","USER_B64"),"base64").toString("utf8")}catch{}let w="";try{w=Buffer.from(o("USER_B64","AGENTS_B64"),"base64").toString("utf8")}catch{}let v="";try{v=Buffer.from(o("AGENTS_B64","MEMORY_B64"),"base64").toString("utf8")}catch{}let E="";try{E=Buffer.from(o("MEMORY_B64","ENV_B64"),"base64").toString("utf8")}catch{}try{let e=JSON.parse(s||"{}");for(let t of Object.keys(e.mcpServers||{}))u.add(t);for(let t of Object.keys(e.tools||{}))u.add(t);!d&&(e.systemPrompt||e.instructions)&&(d=e.systemPrompt||e.instructions)}catch{}return n.NextResponse.json({success:!0,installed:!!r||!!s,version:o("VERSION","MODEL")||null,model:o("MODEL","BINPATH")||null,running:i,binPath:r||null,service:/SSVC=1/.test(t)?"system":/USVC=1/.test(t)?"user":/PROC=1/.test(t)?"process":null,hasSystemd:!0,configJson:s||"",envText:a||"",envKeys:p,skills:[...u],systemPrompt:d,promptFiles:{"PROMPT.md":d,"SOUL.md":$,"USER.md":w,"AGENTS.md":v,"MEMORY.md":E}})}if("save-prompt"===s){let e=String(a.prompt||""),t=a.file||"PROMPT.md",o=Buffer.from(e,"utf8").toString("base64"),s=`mkdir -p "${f}/workspace"
`;return"SOUL.md"===t||"IDENTITY.md"===t?s+=`echo "${o}" | base64 -d > "${f}/workspace/SOUL.md"
echo "${o}" | base64 -d > "${f}/workspace/IDENTITY.md"
`:"USER.md"===t?s+=`echo "${o}" | base64 -d > "${f}/workspace/USER.md"
`:"AGENTS.md"===t?s+=`echo "${o}" | base64 -d > "${f}/workspace/AGENTS.md"
`:"MEMORY.md"===t?s+=`echo "${o}" | base64 -d > "${f}/workspace/MEMORY.md"
`:s+=`echo "${o}" | base64 -d > "${f}/workspace/PROMPT.md"
echo "${o}" | base64 -d > "${f}/prompt.txt"
echo "${o}" | base64 -d > "${f}/SYSTEM_PROMPT.md"
`,await (0,l.execCommand)(c,s,{pool:!1,timeoutMs:3e4}),!1!==a.restart&&await g("restart"),n.NextResponse.json({success:!0,file:t})}if("uninstall"===s){m?(await (0,p.sdInstanceCtl)(c,"openclaw",m,"stop"),await u("stop instance (pidfile-scoped)",`if [ -f "${h}" ]; then p=$(cat "${h}"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${h}"; fi; true`)):(await u("stop system service",`(sudo -n systemctl disable --now ${$} 2>/dev/null || systemctl disable --now ${$} 2>/dev/null); true`),await u("stop user service",`export XDG_RUNTIME_DIR="/run/user/$(id -u)"; systemctl --user disable --now ${$} 2>/dev/null; true`),await u("stop stray processes","pkill -f '[o]penclaw.*gatew[a]y' 2>/dev/null; pkill -f '[o]penclaw gateway' 2>/dev/null; true"));let e=!1;if(!m)try{let t=await (0,p.listInstances)(c,"openclaw");e=Array.isArray(t)&&t.filter(e=>e.tag&&e.tag!==m).length>0}catch{}let t=m||e&&!r?"":'(npm -g rm openclaw 2>/dev/null || true); rm -f "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" /usr/local/bin/openclaw /usr/bin/openclaw /usr/sbin/openclaw; ',s=!m&&r?"pkill -f '[o]penclaw.*gatew[a]y' 2>/dev/null; rm -rf \"$HOME/.openclaw-\"* 2>/dev/null; ":"",a=m?`rm -rf "${f}"; [ ! -e "${f}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`:r?`${s}${t}rm -rf "${f}"; echo REMOVED_ALL`:`${t}rm -rf "${f}/local" "${f}/logs"; echo REMOVED_CODE`,l=await u(m?"remove instance (isolated home)":r?"remove binary, code & all data":"remove binary & code (config kept)",a),i=/REMOVED/.test(l.stdout||"");return n.NextResponse.json({success:i,purged:r,log:o})}if("install"===s){let e=await (0,l.execCommand)(c,w,{pool:!1,timeoutMs:3e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim(),s="1"===t("SUDO");if("1"!==t("CURL")||"1"!==t("TAR")||"1"!==t("GZIP")||"1"!==t("PROCP")){let e=["curl","tar","gzip"].filter(e=>"curl"===e?"1"!==t("CURL"):"gzip"===e?"1"!==t("GZIP"):"1"!==t("TAR")).join(" ")||"curl",o=`export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export DEBIAN_FRONTEND=noninteractive
S="${s?"sudo -n":""}"
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
echo PREREQ_SKIPPED`;await u(`install prerequisites (${e})`,`echo '${d(o)}' | base64 -d | sh 2>&1 | tail -5`,{timeoutMs:3e5})}{let e=0,t=await (0,i.execDetached)(c,"curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1",{pollMs:3e3,timeoutMs:9e5,onLine:t=>{++e<=400&&o.push(t)}});o.push(`$ official installer (--no-onboard)${0!==t.code?` — exited ${t.code}`:" — finished"}${e>400?` (${e} lines total)`:""}${t.stderr?`
${t.stderr.slice(0,300)}`:""}`)}let r=await (0,l.execCommand)(c,E(),{pool:!1,timeoutMs:3e4});if(!(r.stdout||"").match(/BIN=(.*)/)?.[1]?.trim())return n.NextResponse.json({success:!1,error:"Installer finished but the openclaw binary was not found — see log.",log:o});await u("openclaw --version",'export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; openclaw --version 2>&1 | tail -1',{timeoutMs:6e4});{let e=JSON.stringify({gateway:{mode:"local",bind:"loopback"}});await u("merge gateway defaults into openclaw.json",`
          mkdir -p "${f}"
          [ -f "${f}/openclaw.json" ] || echo '{}' > "${f}/openclaw.json"
          cp "${f}/openclaw.json" "${f}/openclaw.json.bak-install"
          echo '${d(e)}' | base64 -d > /tmp/oc-seed.json
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          # Drive the merge off ${f} instead of the hardcoded default home —
          # otherwise installing a tagged instance rewrites the DEFAULT
          # install's openclaw.json rather than the new instance's.
          export OC_HOME="${f}"
          node -e "const fs=require('fs');const p=process.env.OC_HOME+'/openclaw.json';const cur=JSON.parse(fs.readFileSync(p,'utf8'));const seed=JSON.parse(fs.readFileSync('/tmp/oc-seed.json','utf8'));const merged={...seed,...cur};merged.gateway={...seed.gateway,...(cur.gateway||{})};fs.writeFileSync(p,JSON.stringify(merged,null,2));console.log('CONFIG_SEED')"
          rm -f /tmp/oc-seed.json`,{timeoutMs:3e4});let t=Object.entries(a.env||{});if(t.length>0){let e=t.map(([e,t])=>`${e}=${t}`).join("\n");await u("write provider keys to ~/.openclaw/.env",`
            touch "${f}/.env"
            echo '${d(e)}' | base64 -d > /tmp/oc-env-seed
            # 'read -rk' parses as options -r AND -k; -k is not a valid read
            # option, so bash/dash error out and the loop body never runs —
            # provider keys were silently never written even though ENV_SEEDED
            # is echoed below. The space after -r is load-bearing.
            while IFS='=' read -r k; do
              k="\${k%%=*}"
              grep -q "^$\{k}=" "${f}/.env" && sed -i "s|^$\{k}=.*|$k=$(grep "^$\{k}=" /tmp/oc-env-seed | cut -d= -f2-)|" "${f}/.env" || printf '%s\\n' "$(grep "^$\{k}=" /tmp/oc-env-seed)" >> "${f}/.env"
            done < /tmp/oc-env-seed
            rm -f /tmp/oc-env-seed
            echo ENV_SEEDED`,{timeoutMs:3e4})}}let p=a&&a.env||{},m=a&&a.settings||{},$=m.model||m.default_model||p.MODEL||p.OPENCLAW_MODEL||p.DEFAULT_MODEL||"";if($||p.TELEGRAM_BOT_TOKEN){let e={};if(p.TELEGRAM_BOT_TOKEN){let t=String(p.TELEGRAM_ALLOWED_USERS||"").split(",").map(e=>e.trim()).filter(Boolean);e.channels={telegram:{enabled:!0,botToken:p.TELEGRAM_BOT_TOKEN,dmPolicy:"allowlist",...t.length?{allowFrom:t}:{}}}}$&&(e.agents={defaults:{model:$}});let t=d(JSON.stringify(e));await u("merge model + telegram into openclaw.json",`
          export OC_HOME="${f}"
          python3 -c "
import json, os, base64
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
cur = json.load(open(p)) if os.path.exists(p) else {}
s = json.loads(base64.b64decode('${t}').decode('utf8'))
cur.pop('defaultModel', None)
cur.pop('model', None)
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, s)
open(p, 'w').write(json.dumps(cur, indent=2))
print('MODEL_TG_MERGED')
" 2>&1 | tail -2`,{timeoutMs:3e4})}let v=await g("start"),h=v.ok?"1"===t("INITD")?"systemd-user":"nohup":"manual";await u("start gateway",`echo GW_${v.ok?"UP":"DEFERRED"}${v.ok?"":`
${(v.out||"").slice(0,300)}`}`);let O=async()=>{let e=await (0,l.execCommand)(c,w,{pool:!1,timeoutMs:6e4}),t=t=>(e.stdout||"").match(RegExp(`${t}=(.*)`))?.[1]?.trim();return"1"===t("USVC")||"1"===t("SSVC")||"1"===t("PROC")};await new Promise(e=>setTimeout(e,5e3));let S=await O();if(!S){let e=await g("start");await u("retry start gateway",`echo GW_${e.ok?"UP":"DOWN"}${e.ok?"":`
${(e.out||"").slice(0,300)}`}`,{timeoutMs:12e4}),await new Promise(e=>setTimeout(e,5e3)),S=await O()}return n.NextResponse.json({success:S,running:S,startMethod:h,version:t("VERSION"),error:S?null:"Gateway did not stay running — check ~/.openclaw/logs/ (usually a missing provider API key; set it via the Config tab or run `openclaw onboard` on the server).",log:o})}let O=async(e=24)=>{let t=(await g("status")).active;for(let o=0;!t&&o<e;o+=6)await new Promise(e=>setTimeout(e,6e3)),t=(await g("status")).active;return t};if("gateway"===s){let e=a.op||"status",t=await g(e),o=t.active;return void 0===o&&!1!==t.ok&&"stop"!==e&&(o=await O()),n.NextResponse.json({success:!1!==t.ok,op:e,active:o,output:t.out||""})}if("logs"===s){let e=Number(a.cursor||0),t=Math.min(Number(a.lines||300),1e3),o=`
ACTIVE=""
for f in "${f}/logs/gatew""ay.log" "${f}/logs/"*.log /tmp/openclaw*.log; do
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
`,s=(await (0,l.execCommand)(c,o,{pool:!1,timeoutMs:45e3})).stdout||"",r=s.match(/SIZE=(\d+)/)?.[1],i=s.match(/FILE=(.*)/)?.[1]?.trim(),p=s.indexOf("===DATA===");return n.NextResponse.json({success:!0,size:r?Number(r):0,file:i||null,data:p>=0?s.slice(p+10):""})}if("health"===s){let e=`
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
res=0; [ -f "${h}" ] && kill -0 $(cat "${h}") 2>/dev/null && res=1
if [ "$res" = 0 ] && [ -n "${m}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active openclaw-gatew""ay@${m} 2>/dev/null | grep -qx active && res=1
fi
ALIVE=$res
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE '18789${v?`|${v}`:""}') && PORT=1
echo "ALIVE=$ALIVE"; echo "PORT=$PORT"
PID=$(cat "${h}" 2>/dev/null)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "${f}/logs/gatew""ay.log" "${f}/logs/"*.log /tmp/openclaw*.log; do
  [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break
done
if [ -n "$LOGL" ]; then
  if tail -n 300 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
    TG=error
  fi
fi
echo "TG=$TG"
`,t=(await (0,l.execCommand)(c,e,{pool:!1,timeoutMs:45e3})).stdout||"",o=e=>(t.match(RegExp(`${e}=([^\\n]*)`))||[])[1]?.trim();return n.NextResponse.json({success:!0,alive:"1"===o("ALIVE"),portListening:"1"===o("PORT"),uptimeSec:Number(o("UPTIME_SEC")||0),telegram:o("TG")||"unknown",errorCount:0,recentErrors:[]})}if("backups"===s){let e=((await (0,l.execCommand)(c,`ls -1t "${f}"/openclaw.json.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,{pool:!1,timeoutMs:3e4})).stdout||"").split("\n").filter(Boolean).map(e=>{let t=e.split("|");return{name:t[0],date:t[1]||"",size:Number(t[2])||0}});return n.NextResponse.json({success:!0,backups:e})}if("restore-backup"===s){let e=String(a.name||a.backup||"");if(!/^openclaw\.json\.bak-[A-Za-z0-9._-]+$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid backup name"},{status:400});let t=await (0,l.execCommand)(c,`[ -f "${f}/${e}" ] && cp "${f}/${e}" "${f}/openclaw.json" && echo RESTORED || echo NOT_FOUND`,{pool:!1,timeoutMs:3e4}),o=/RESTORED/.test(t.stdout||""),s=!1;return o&&(s=(await g("restart")).ok),n.NextResponse.json({success:o&&s,restarted:s,error:o?s?null:"restored but gateway did not start":"Backup file not found"})}if("reconfigure"===s){let e=a&&a.env||{},t=a&&a.settings||{},s=String(e.CUSTOM_LLM_API_KEY||"").trim()||String(e.OPENAI_API_KEY||"").trim(),l=String(e.OPENAI_BASE_URL||e.OPENAI_API_BASE||"").trim();s&&l&&(e.OPENAI_API_KEY=s,e.OPENAI_BASE_URL=l,e.LLM_API_BASE=l,e.CUSTOM_LLM_API_KEY=s);let r=Object.keys(e).filter(t=>null!=e[t]&&""!==e[t]),i=Object.keys(t).filter(e=>null!=t[e]&&""!==t[e]).length>0;if(0===r.length&&!i)return n.NextResponse.json({success:!1,error:"No settings or env keys to update"},{status:400});if(r.length>0){let t=d(r.map(t=>`${t}=${e[t]}`).join("\n")),s=`import os, base64
lines_raw = base64.b64decode('${t}').decode('utf-8').splitlines()
ep = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/.env'
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
print('ENV_UPDATED')`;d(s);let a=await u("write ~/.openclaw/.env",`export OC_HOME="${f}"; echo '\${envPyB64}' | base64 -d | python3`,{timeoutMs:3e4});if(!/ENV_UPDATED/.test(a.stdout||""))return n.NextResponse.json({success:!1,error:"Failed to write ~/.openclaw/.env",log:o})}let c=i&&(t.model||t.default_model)||e.MODEL||e.OPENCLAW_MODEL||e.DEFAULT_MODEL||"";if(c||e.TELEGRAM_BOT_TOKEN){let t={};if(e.TELEGRAM_BOT_TOKEN){let o=String(e.TELEGRAM_ALLOWED_USERS||"").split(",").map(e=>e.trim()).filter(Boolean);t.channels={telegram:{enabled:!0,botToken:e.TELEGRAM_BOT_TOKEN,dmPolicy:"allowlist",...o.length?{allowFrom:o}:{}}}}c&&(t.agents={defaults:{model:c}});let o=d(JSON.stringify(t));await u("merge ~/.openclaw/openclaw.json settings",`
          export OC_HOME="${f}"
          python3 -c "
import json, os, base64
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
cur = json.load(open(p)) if os.path.exists(p) else {}
s = json.loads(base64.b64decode('${o}').decode('utf8'))
# strip legacy root keys written by older monitor versions - they make the
# whole config fail schema validation ('<root>: Invalid input')
cur.pop('defaultModel', None)
cur.pop('model', None)
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, s)
json.dump(cur, open(p, 'w'), indent=2)
print('OPENCLAW_CONFIG_MERGED')
" 2>/dev/null || true`)}let p=await g("restart");return n.NextResponse.json({success:p.ok,restarted:p.ok,startMethod:p.ok?"restart":null,error:p.ok?null:p.error,log:o})}if("save-config"===s){let e=String(a.configJson??"");if(!e.trim())return n.NextResponse.json({success:!1,error:"openclaw.json content is empty"},{status:400});try{JSON.parse(e)}catch(e){return n.NextResponse.json({success:!1,error:`Invalid JSON: ${e.message}`},{status:400})}let t=await (0,l.execCommand)(c,`
        cp "${f}/openclaw.json" "${f}/openclaw.json.bak-$(date +%s)" 2>/dev/null || true
        echo '${d(e)}' | base64 -d > "${f}/openclaw.json.new"
        python3 -m json.tool "${f}/openclaw.json.new" >/dev/null 2>&1 && { mv "${f}/openclaw.json.new" "${f}/openclaw.json"; echo CONFIG_SAVED; } || echo CONFIG_INVALID`,{pool:!1,timeoutMs:3e4});if(/CONFIG_INVALID/.test(t.stdout||""))return n.NextResponse.json({success:!1,error:"Remote JSON validation failed — config not replaced."},{status:400});let o=!1,s=!1;if(a.restart){let e=await g("restart");if(o=e.ok,!(e.ok&&await O(24))){let e=await (0,l.execCommand)(c,`BAK="$(ls -1t "${f}"/openclaw.json.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${f}/openclaw.json" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,{pool:!1,timeoutMs:3e4});if(/ROLLED_BACK/.test(e.stdout||"")){s=!0,await g("restart");let t=await O(24);return n.NextResponse.json({success:t,restarted:t,rolledBack:!0,error:t?null:"Rolled back previous config but gateway still down — check ~/.openclaw/logs/",log:[`Your saved config broke the gateway — automatically restored ${((e.stdout||"").match(/ROLLED_BACK_TO=(.*)/)||[])[1]||"last backup"}`]})}}}return n.NextResponse.json({success:!0,restarted:o,rolledBack:s})}if("skills"===s){let e=a.op,t={filesystem:{command:"npx",args:["-y","@modelcontextprotocol/server-filesystem","/root"]},github:{command:"npx",args:["-y","@modelcontextprotocol/server-github"]},fetch:{command:"npx",args:["-y","@modelcontextprotocol/server-fetch"]},"brave-search":{command:"npx",args:["-y","@modelcontextprotocol/server-brave-search"]},puppeteer:{command:"npx",args:["-y","@modelcontextprotocol/server-puppeteer"]},postgres:{command:"npx",args:["-y","@modelcontextprotocol/server-postgres","postgresql://localhost/mydb"]},memory:{command:"npx",args:["-y","@modelcontextprotocol/server-memory"]}};if("remove"===e){let e=String(a.name||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid skill/MCP name"},{status:400});await u("remove MCP/skill",`
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          export OC_HOME="${f}"
          python3 -c "
import json, os
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
if os.path.exists(p):
    cur = json.load(open(p))
    cur.setdefault('mcpServers', {}).pop('${e}', None)
    cur.setdefault('tools', {}).pop('${e}', None)
    json.dump(cur, open(p, 'w'), indent=2)
" 2>/dev/null || true
          rm -rf "${f}/skills/${e}" 2>/dev/null || true`);let t=await g("restart");return n.NextResponse.json({success:!0,restarted:t.ok,log:[`Removed ${e}`]})}if("install"===e){let e=String(a.id||"").trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(e))return n.NextResponse.json({success:!1,error:"Invalid skill id"},{status:400});let o=Object.keys(t).find(t=>t.toLowerCase()===e.toLowerCase()),s=o?t[o]:{command:"npx",args:["-y",e]},l=d(JSON.stringify(s)),r=(o||e.split("/").pop()).replace(/[^a-zA-Z0-9_-]/g,"_");await u("install MCP/skill",`
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          export OC_HOME="${f}"
          mkdir -p "${f}/skills/${r}"
          python3 -c "
import json, os, base64
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
cur = json.load(open(p)) if os.path.exists(p) else {}
mcp = json.loads(base64.b64decode('${l}').decode('utf8'))
cur.setdefault('mcpServers', {})['${r}'] = mcp
json.dump(cur, open(p, 'w'), indent=2)
print('MCP_ADDED')
" 2>/dev/null || true`);let i=await g("restart");return n.NextResponse.json({success:!0,restarted:i.ok,output:`Configured MCP skill ${r}`})}if("install-content"===e){let e=String(a.name||a.id||"").trim(),t=e.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"").slice(0,64)||"custom-skill",o=String(a.content||"").trim();o||(o=`# ${e}

Skill definition for ${e}.
`);let s=d(o);await u("install skill content",`
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          mkdir -p "${f}/skills/${t}"
          python3 -c "import base64; open('${f}/skills/${t}/SKILL.md','w').write(base64.b64decode('${s}').decode('utf8'))" 2>/dev/null || true`);let l=await g("restart");return n.NextResponse.json({success:!0,restarted:l.ok,output:`Installed skill "${e}" with full content`})}return n.NextResponse.json({success:!1,error:`Unknown skills op: ${e}`},{status:400})}if("pairing-approve"===s){let e=String(a.platform||"telegram").trim(),t=String(a.code||"").trim();if(!t)return n.NextResponse.json({success:!1,error:"Pairing code is required"},{status:400});let s=await (0,l.execCommand)(c,E(),{pool:!1,timeoutMs:15e3}),r=(s.stdout||"").match(/BIN=(.*)/)?.[1]?.trim()||"openclaw",i=JSON.stringify(r),p=`export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; set -a; [ -f "${f}/.env" ] && . "${f}/.env"; set +a`,d=e&&"auto"!==e?`${p}; ${i} pairing approve ${JSON.stringify(e)} ${JSON.stringify(t)} 2>&1 || ${i} pairing approve ${JSON.stringify(t)} 2>&1`:`${p}; ${i} pairing approve telegram ${JSON.stringify(t)} 2>&1 || ${i} pairing approve ${JSON.stringify(t)} 2>&1`,m=await u(`pairing approve ${e?e+" ":""}${t}`,d),$=((m.stdout||"")+(m.stderr||"")).trim(),w=!/error|failed|invalid/i.test($)||/approved|success|paired|ok/i.test($);return n.NextResponse.json({success:w,output:$||"Pairing command executed",log:o})}if("pairing-list"===s){let e=await (0,l.execCommand)(c,E(),{pool:!1,timeoutMs:15e3}),t=(e.stdout||"").match(/BIN=(.*)/)?.[1]?.trim()||"openclaw",o=JSON.stringify(t),s=`export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; set -a; [ -f "${f}/.env" ] && . "${f}/.env"; set +a`,a=(await (0,l.execCommand)(c,`${s}; ${o} pairing list 2>&1 || true; { FILE="$(ls -1t "${f}/logs/"*.log 2>/dev/null | head -1)"; [ -n "$FILE" ] && tail -n 80 "$FILE"; } || true`,{pool:!1,timeoutMs:2e4})).stdout||"",r=[...a.matchAll(/pairing\s+approve\s+(?:(\w+)\s+)?([A-Z0-9]{6,12})/gi),...a.matchAll(/code[:\s]+([A-Z0-9]{6,12})/gi),...a.matchAll(/pairing\s+code\s+is\s+([A-Z0-9]{6,12})/gi),...a.matchAll(/Pairing:\s+([A-Z0-9]{6,12})/gi)],i=[];for(let e of r){let t=e[2]||e[1],o=e[2]?e[1]:"telegram";t&&!i.some(e=>e.code===t)&&i.push({code:t,platform:o||"telegram"})}return n.NextResponse.json({success:!0,pending:i,raw:a.slice(-1e3)})}return n.NextResponse.json({success:!1,error:`Unknown action: ${s}`},{status:400})}catch(e){return c.logger.error("[openclaw-agent] action failed:",e.message),n.NextResponse.json({success:!1,error:e.message},{status:500})}}e.s(["POST",0,d]),o()}catch(e){o(e)}},!1),47810,e=>{"use strict";var t=e.i(8970),o=e.i(74017),n=e.i(96250),s=e.i(59756),a=e.i(61916),l=e.i(74677),r=e.i(69741),i=e.i(16795),c=e.i(87718),p=e.i(95169),u=e.i(47587),d=e.i(66012),m=e.i(70101),$=e.i(26937),w=e.i(10372),f=e.i(93695);e.i(52474);var v=e.i(5232);let h=new t.AppRouteRouteModule({definition:{kind:o.RouteKind.APP_ROUTE,page:"/api/agents/openclaw/route",pathname:"/api/agents/openclaw",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/agents/openclaw/route.js",nextConfigOutput:"",userland:()=>e.r(86724),...{}}),{workAsyncStorage:E,workUnitAsyncStorage:g,serverHooks:O}=h;async function S(e,t,n){n.requestMeta&&(0,s.setRequestMeta)(e,n.requestMeta),h.isDev&&(0,s.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let E="/api/agents/openclaw/route";E=E.replace(/\/index$/,"")||"/";let g=await h.prepare(e,t,{srcPage:E,multiZoneDraftMode:!1});if(!g)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:O,deploymentId:S,params:R,nextConfig:N,parsedUrl:b,isDraftMode:T,prerenderManifest:y,routerServerContext:x,isOnDemandRevalidate:P,revalidateOnlyGenerated:C,resolvedPathname:M,clientReferenceManifest:A,serverActionsManifest:_}=g,I=(0,r.normalizeAppPath)(E),k=!!(y.dynamicRoutes[I]||y.routes[M]),L=async()=>((null==x?void 0:x.render404)?await x.render404(e,t,b,!1):t.end("This page could not be found"),null);if(k&&!T){let e=!!y.routes[M],t=y.dynamicRoutes[I];if(t&&!1===t.fallback&&!e){if(N.adapterPath)return await L();throw new f.NoFallbackError}}let D=null;!k||h.isDev||T||(D="/index"===(D=M)?"/":D);let j=!0===h.isDev||!k,H=k&&!j;_&&A&&(0,l.setManifestsSingleton)({page:E,clientReferenceManifest:A,serverActionsManifest:_});let U=e.method||"GET",B=(0,a.getTracer)(),G=B.getActiveScopeSpan(),V=!!(null==x?void 0:x.isWrappedByNextServer),q=!!(0,s.getRequestMeta)(e,"minimalMode"),F=(0,s.getRequestMeta)(e,"incrementalCache")||await h.getIncrementalCache(e,N,y,q);null==F||F.resetRequestCache(),globalThis.__incrementalCache=F;let K={params:R,previewProps:y.preview,renderOpts:{experimental:{authInterrupts:!!N.experimental.authInterrupts,useCacheTimeout:N.experimental.useCacheTimeout},cacheComponents:!!N.cacheComponents,validationLevel:N.experimental.instantInsights.validationLevel,supportsDynamicResponse:j,incrementalCache:F,hmrRefreshHash:(0,s.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:N.cacheLife,staticPageGenerationTimeout:N.staticPageGenerationTimeout,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,o,n,s)=>h.onRequestError(e,t,n,s,x)},sharedContext:{buildId:O,deploymentId:S}},Y=new i.NodeNextRequest(e),Z=new i.NodeNextResponse(t),z=c.NextRequestAdapter.fromNodeNextRequest(Y,(0,c.signalFromNodeResponse)(t)),W=async({previousCacheEntry:o})=>{try{if(!q&&P&&C&&!o)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await h.handle(z,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let a=K.renderOpts.pendingWaitUntil;a&&n.waitUntil&&(n.waitUntil(a),a=void 0);let l=K.renderOpts.collectedTags;if(!k)return await (0,d.sendResponse)(Y,Z,s,a),null;{let e=await s.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(s.headers);l&&(t[w.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let o=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=w.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,n=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=w.INFINITE_CACHE?!1!==o&&o>0?N.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:o,expire:n}}}}catch(t){throw(null==o?void 0:o.isStale)&&await h.onRequestError(e,t,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:H,isOnDemandRevalidate:P})},!1,x),t}},J=async(s,l)=>{try{var r,i;let s=await h.handleResponse({req:e,nextConfig:N,cacheKey:D,routeKind:o.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:P,revalidateOnlyGenerated:C,responseGenerator:W,waitUntil:n.waitUntil,isMinimalMode:q});if(!k)return;if((null==s||null==(r=s.value)?void 0:r.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==s||null==(i=s.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});q||t.setHeader("x-nextjs-cache",P?"REVALIDATED":s.isMiss?"MISS":s.isStale?"STALE":"HIT"),T&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let a=(0,m.fromNodeOutgoingHttpHeaders)(s.value.headers);q&&k||a.delete(w.NEXT_CACHE_TAGS_HEADER),!s.cacheControl||t.getHeader("Cache-Control")||a.get("Cache-Control")||a.set("Cache-Control",(0,$.getCacheControlHeader)(s.cacheControl)),await (0,d.sendResponse)(Y,Z,new Response(s.value.body,{headers:a,status:s.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await h.onRequestError(e,t,{routerKind:"App Router",routePath:I,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:H,isOnDemandRevalidate:P})},!1,x),k)throw t;await (0,d.sendResponse)(Y,Z,new Response(null,{status:500}));return}finally{(()=>{if(!s)return;let e=t.statusCode;s.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(s.setStatus({code:a.SpanStatusCode.ERROR}),s.setAttribute("error.type",e.toString()));let o=B.getRootSpanAttributes();if(!o)return;if(o.get("next.span_type")!==p.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${o.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=o.get("next.route")||I,r=`${U} ${n}`;s.setAttributes({"next.route":n,"http.route":n,"next.span_name":r}),s.updateName(r),l&&l!==s&&(l.setAttribute("http.route",n),l.updateName(r))})()}};if(V&&G)await J(G,void 0);else{let t=B.getActiveScopeSpan();await B.withPropagatedContext(e.headers,()=>B.trace(p.BaseServerSpan.handleRequest,{spanName:`${U} ${E}`,kind:a.SpanKind.SERVER,attributes:{"http.method":U,"http.target":e.url}},e=>J(e,t)),void 0,!V)}}e.s(["handler",0,S,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:E,workUnitAsyncStorage:g})},"routeModule",0,h,"serverHooks",0,O,"workAsyncStorage",0,E,"workUnitAsyncStorage",0,g])}];

//# sourceMappingURL=_0hlkmxs._.js.map