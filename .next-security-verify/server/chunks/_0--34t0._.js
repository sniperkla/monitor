module.exports=[73721,e=>e.a(async(t,r)=>{try{var o=e.i(89171),n=e.i(23667),a=e.i(80533),i=e.i(33405),s=e.i(29072),l=e.i(46589),c=e.i(86362),d=e.i(54981),u=e.i(73757);e.i(89228);var p=e.i(91601),m=e.i(24699),f=e.i(8816),g=e.i(51631),h=t([a,l,f]);async function v(e){try{let t=await (0,n.getServerSession)(a.authOptions);if(!t)return o.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let r=(0,m.normalizeUserId)(t.user?.id||t.user?.sub||t.user?.email),{searchParams:h}=new URL(e.url),v=h.get("project")||"default",y="default"===v?"auto_deploy_config":`auto_deploy_config_${v}`,{targetType:N,connectionId:$,projectPath:A,deployCommand:E,aiModel:_,aiCustomModel:R,aiEndpoint:S,aiApiKey:k}=await e.json();if(!k&&!await (0,f.canUseServerAi)(t.user.email))return(0,f.aiSupporterRequiredResponse)();if(!N)return o.NextResponse.json({success:!1,error:"Target type is required"},{status:400});let x="",b=A?.trim()||".";if(/[;&|`$(){}!#]/.test(b)||b.includes(".."))return o.NextResponse.json({success:!1,error:"Invalid project path"},{status:400});let w=`cd "${b}" ; echo "=== LS ===" ; ls -la 2>/dev/null || true ; echo "=== PACKAGE JSON ===" ; cat package.json 2>/dev/null || true ; echo "=== DOCKER COMPOSE ===" ; cat docker-compose.yml 2>/dev/null || cat docker-compose.yaml 2>/dev/null || echo "No docker-compose.yml found" ; echo "=== DOCKERFILE ===" ; cat Dockerfile 2>/dev/null || true ; echo "=== REQUIREMENTS ===" ; cat requirements.txt 2>/dev/null || true ; cat pyproject.toml 2>/dev/null || true ; cat pom.xml 2>/dev/null || true ; cat build.gradle 2>/dev/null || true ; echo "=== SYSTEM INFORMATION ===" ; uname -a 2>/dev/null || true ; cat /etc/os-release 2>/dev/null | grep -E "^(NAME|VERSION)=" || true ; echo "=== DOCKER VERSION ===" ; docker --version 2>/dev/null || echo "Docker not installed" ; echo "=== DOCKER COMPOSE PLUGIN ===" ; docker compose version 2>/dev/null || echo "Plugin docker compose NOT available" ; echo "=== DOCKER COMPOSE LEGACY BINARY ===" ; docker-compose --version 2>/dev/null || echo "Binary docker-compose NOT available" ; echo "=== DOCKER SWARM STATUS ===" ; docker info 2>/dev/null | grep -i "Swarm:" || echo "Swarm status unknown" ; echo "=== NGINX CONFIG (from container) ===" ; docker exec global-nginx cat /etc/nginx/nginx.conf 2>/dev/null || docker exec nginx cat /etc/nginx/nginx.conf 2>/dev/null || echo "Could not read nginx.conf from container" ; echo "=== NGINX CONF.D (from container) ===" ; docker exec global-nginx sh -c "ls /etc/nginx/conf.d/ 2>/dev/null && cat /etc/nginx/conf.d/*.conf 2>/dev/null" || docker exec nginx sh -c "ls /etc/nginx/conf.d/ 2>/dev/null && cat /etc/nginx/conf.d/*.conf 2>/dev/null" || echo "Could not read conf.d from container" ; echo "=== NGINX SITES-ENABLED (from container) ===" ; docker exec global-nginx sh -c "ls /etc/nginx/sites-enabled/ 2>/dev/null && cat /etc/nginx/sites-enabled/* 2>/dev/null" || docker exec nginx sh -c "ls /etc/nginx/sites-enabled/ 2>/dev/null && cat /etc/nginx/sites-enabled/* 2>/dev/null" || echo "No sites-enabled in container" ; echo "=== NGINX CONFIG (host filesystem) ===" ; cat /etc/nginx/nginx.conf 2>/dev/null || echo "No host nginx.conf" ; find /etc/nginx/conf.d /etc/nginx/sites-enabled /home/*/nginx /root/nginx 2>/dev/null -name "*.conf" | head -20 | xargs -I{} sh -c 'echo "--- {} ---" && cat {}' 2>/dev/null || true`;if("local"===N)x=await new Promise(e=>{(0,i.exec)(w,{timeout:3e4},(t,r,o)=>{e((r||o||t?.message||"").toString())})});else{if("ssh"!==N)return o.NextResponse.json({success:!1,error:"Unsupported target type"},{status:400});if(!$)return o.NextResponse.json({success:!1,error:"Connection ID is required for SSH target"},{status:400});let e=await (0,l.default)(),r=new d.ConnectionRepository(e,t?.user?.id||t?.user?.sub||null);await r.init();let n=await r.findById($);if(!n)return o.NextResponse.json({success:!1,error:"SSH Connection not found"},{status:404});let a={host:n.host,port:n.port||22,username:n.username,readyTimeout:2e4};if("password"===n.authType)try{a.password=(0,u.decrypt)(n.password)}catch(e){a.password=n.password}else if(n.privateKey){try{a.privateKey=(0,u.decrypt)(n.privateKey)}catch(e){a.privateKey=n.privateKey}if(n.passphrase)try{a.passphrase=(0,u.decrypt)(n.passphrase)}catch(e){a.passphrase=n.passphrase}}x=await new Promise(e=>{let t=new s.Client,r=setTimeout(()=>{t.end(),e("SSH Connection Error: timed out after 30 seconds")},3e4);t.on("ready",()=>{clearTimeout(r),t.exec(w,{timeout:3e4},(r,o)=>{if(r)return t.end(),e(`SSH Exec Error: ${r.message}`);let n="";o.on("data",e=>{n+=e.toString()}),o.stderr.on("data",e=>{n+=e.toString()}),o.on("close",()=>{t.end(),e(n)})})}),t.on("error",t=>{clearTimeout(r),e(`SSH Connection Error: ${t.message}`)}),t.connect(a)})}await (0,l.default)(process.env.MONGODB_URI,!0);let I=await c.default.findOne({key:"ai_api_keys"}),T=await c.default.findOne({key:"ai_config"}),O=(0,m.resolveUserIdQuery)(r),C=await c.default.findOne({...O,key:y}),M=C?.value||{},D=E||M.deployCommand||"",P=process.env.GROQ_API_KEY||"";if(I?.value?.keys&&Array.isArray(I.value.keys)&&I.value.keys.length>0){let e=I.value.currentIndex||0;P=I.value.keys[e]||I.value.keys[0]}let U=_||M.aiModel,L=R||M.aiCustomModel,j=S&&S.trim()?S.trim():M.aiEndpoint||"",G=k&&k.trim()?k.trim():M.aiApiKey||"",z="https://api.groq.com/openai/v1",H=T?.value?.model||"llama-3.3-70b-versatile",F=!1;if("manual"===U||j&&G){let e=j||"https://api.openai.com/v1";if(z=e=e.replace(/\/chat\/completions\/?$/,"").replace(/\/+$/,""),H=L||"gpt-3.5-turbo",P=G||P,F=!z.includes("api.groq.com")&&!z.includes("api.openai.com"),!P)return o.NextResponse.json({success:!1,error:"Custom AI API Key is required. Enter your API key in the Auto Deploy → AI Settings section."},{status:400})}else U&&"auto"!==U&&(H=U);if(!P)return o.NextResponse.json({success:!1,error:"AI API Key is not configured. Please add a Groq API key in the global AI settings, or switch to Manual mode and enter a custom API key in the Auto Deploy settings."},{status:400});P=(P||"").replace(/[^\x20-\x7E]/g,"").trim(),z=(z||"").replace(/[^\x20-\x7E]/g,"").trim(),H=(H||"").replace(/[^\x20-\x7E]/g,"").trim();let K=(x||"").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uFFFF]/g,""),q=/docker\s+(swarm|service|stack)/.test(D),B=`You are an expert DevOps AI agent analyzing a project repository, Docker Compose file, and Nginx reverse proxy configuration.

CRITICAL INSTRUCTIONS:
1. ENVIRONMENT & SERVICES IDENTIFICATION:
   - Carefully examine docker-compose.yml and Nginx proxy configs (proxy_pass directives).
   - Identify all application services (containers) that need to be built and deployed (e.g., frontend, backend).
   - Determine their container_name / service name, build context directory (e.g., ./frontend, ./backend, or ./), and exposed/proxied port (e.g., 3033, 3090).
2. SCRIPT CONSTRUCT & PRESERVATION:
   - If an existing deployment script is provided, keep all original "cd", "git pull", custom environment setup, echo/log statements.
   - Put \`#!/bin/bash\` ONLY ONCE at the top. Do NOT add \`set -e\` — Swarm rollback commands exit non-zero by design and set -e would abort the script mid-rollback.
   - Do NOT include any docker service/swarm commands in "deployCommand" — the system handles zero-downtime Swarm injection.
   - When generating docker-compose up commands, ALWAYS include \`--force-recreate\` flag to ensure containers are recreated with fresh state on each deployment.

You MUST respond with a valid JSON object ONLY:
{
  "projectType": "Name of project type",
  "technologies": ["tech1", "tech2"],
  "services": [
    { "name": "service_container_name", "buildDir": "frontend_or_backend_or_empty", "port": 3033 }
  ],
  "deployCommand": "string representing standard bash script with newlines",
  "summary": "Concise summary of identified services, build context, and proxy ports"
}`,W=`Here is the scanned directory listing, project config files, system environment probe, and nginx config for the project path "${b}":

${K}

Existing deployment script (USE AS BASELINE REFERENCE to preserve cd, git pull, etc.):
${D||"# No previous script set"}`;g.logger.info(`[ai-analyze] OpenAI SDK Client -> baseURL: ${z} | model: ${H} | keyPrefix: ${P?P.slice(0,8)+"...":"EMPTY"}`);let X=new p.default({baseURL:z,apiKey:P}),Y=null;try{let e={model:H,temperature:.1,messages:[{role:"system",content:B},{role:"user",content:W}],stream:!1,...!F?{response_format:{type:"json_object"}}:{}},t=await X.chat.completions.create(e),r=t.choices?.[0]?.message?.content;if(!r)throw Error("AI returned an empty response. Check your model name and endpoint.");try{Y=JSON.parse(r)}catch(t){let e=r.match(/```(?:json)?\s*([\s\S]*?)\s*```/)||r.match(/(\{[\s\S]*\})/);if(e)Y=JSON.parse(e[1]);else throw Error(`Could not parse JSON from AI response: ${r.slice(0,200)}`)}}catch(e){return g.logger.error("[ai-analyze] OpenAI SDK call failed:",e.message),o.NextResponse.json({success:!1,error:`AI analysis failed: ${e.message}`},{status:500})}if(!Y)return o.NextResponse.json({success:!1,error:"AI did not return a valid response."},{status:500});let V="",Z=[],J=x.replace(/\r\n/g,"\n").replace(/\r/g,"\n"),Q=J.indexOf("=== DOCKER COMPOSE ==="),ee="";if(-1!==Q){let e=J.slice(Q+22),t=e.indexOf("\n===");ee=(-1!==t?e.slice(0,t):e).trim()}ee||(ee=J),g.logger.info(`[ai-analyze] compose content length: ${ee.length} chars`);let et=function(e){let t,r={},o=e.search(/^services\s*:/m);if(-1===o)return r;let n=e.slice(o+e.slice(o).indexOf("\n")+1),a=n.search(/^[a-zA-Z0-9]/m),i=-1!==a?n.slice(0,a):n,s=/^  ([a-zA-Z0-9_][a-zA-Z0-9_-]*):/gm,l=[];for(;null!==(t=s.exec(i));)l.push({name:t[1],start:t.index,end:t.index+t[0].length});for(let e=0;e<l.length;e++){let t=l[e],o=t.end,n=e+1<l.length?l[e+1].start:i.length,a=i.slice(o,n),s=a.match(/container_name:\s*([a-zA-Z0-9._-]+)/),c=s?s[1].trim():t.name,d="",u=a.match(/build:\s*(\S+)/);if(u){let e=u[1].trim();"context:"!==e&&"|"!==e&&">"!==e&&(d=e.replace(/^\.\//,""))}let p=a.match(/context:\s*(\S+)/);p&&(d=p[1].trim().replace(/^\.\//,""));let m=[],f=a.match(/ports:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/);if(f){let e,t=/- +['"]?(\d+:\d+|\d+)['"]?/g;for(;null!==(e=t.exec(f[1]));){let t=e[1];m.push(t.includes(":")?t:`${t}:${t}`)}}r[c]={buildDir:d,ports:m},g.logger.info(`[ai-analyze] Parsed service: ${t.name} → containerName=${c}, buildDir=${d||"(root)"}, ports=[${m.join(",")}]`)}return r}(ee);if(Y?.services&&Array.isArray(Y.services))for(let e of Y.services){if(!e||!e.name)continue;let t=String(e.name).trim(),r=e.buildDir?String(e.buildDir).trim().replace(/^\.\//,""):"",o=e.port?String(e.port).trim():"";et[t]?(!et[t].buildDir&&r&&(et[t].buildDir=r),(!et[t].ports||0===et[t].ports.length)&&o&&(et[t].ports=[o.includes(":")?o:`${o}:${o}`])):et[t]={buildDir:r,ports:o?[o.includes(":")?o:`${o}:${o}`]:[]},g.logger.info(`[ai-analyze] Merged AI LLM service: ${t} -> buildDir=${r}, port=${o}`)}if(Object.keys(et).length>0){let e=/^(db|database|redis|mongo|mysql|postgres|rabbitmq|memcached|elasticsearch|zookeeper|kafka)$/i;Z=Object.keys(et).filter(t=>!e.test(t)),g.logger.info(`[ai-analyze] Services from compose YAML & AI LLM: ${Z.join(", ")}`)}if(0===Z.length){let e=J.match(/container_name:\s*([a-zA-Z0-9._-]+)/g);e&&(Z=Array.from(new Set(e.map(e=>e.replace(/container_name:\s*/,"").trim()))),g.logger.info(`[ai-analyze] Services from container_name grep: ${Z.join(", ")}`))}0===Z.length?(Z=[(b.split("/").filter(Boolean).pop()||"app").toLowerCase().replace(/[^a-z0-9._-]/g,"")],g.logger.warn(`[ai-analyze] WARNING: Falling back to folder name: ${Z[0]}`)):g.logger.info(`[ai-analyze] Final services: ${Z.join(", ")}`);let er=function(e,t){let r={},o="";for(let t of["NGINX CONF.D (from container)","NGINX SITES-ENABLED (from container)","NGINX CONFIG (from container)","NGINX CONFIG (host filesystem)"]){let r=`=== ${t} ===`,n=e.indexOf(r);if(-1!==n){let a=e.slice(n+r.length),i=a.indexOf("\n==="),s=(-1!==i?a.slice(0,i):a).trim();g.logger.info(`[ai-analyze] Nginx section "${t}" found — ${s.length} chars`),o+=s+"\n"}else g.logger.info(`[ai-analyze] Nginx section "${t}" NOT found in probe output`)}if(!o.trim())return g.logger.warn("[ai-analyze] No Nginx config content extracted from probe. Port detection will be skipped."),r;for(let e of(g.logger.info(`[ai-analyze] Total Nginx content: ${o.length} chars`),g.logger.info("[ai-analyze] Nginx content preview:",o.slice(0,500).replace(/\n/g,"\\n")),t)){let t=o.match(RegExp(`proxy_pass\\s+https?://${e}:(\\d+)`,"i"));if(t){let o=t[1];r[e]=`${o}:${o}`,g.logger.info(`[ai-analyze] Nginx port for ${e}: ${o} (from proxy_pass)`);continue}let n=o.match(RegExp(`server\\s+${e}:(\\d+)`,"i"));if(n){let t=n[1];r[e]=`${t}:${t}`,g.logger.info(`[ai-analyze] Nginx port for ${e}: ${t} (from upstream server)`);continue}g.logger.info(`[ai-analyze] No Nginx port pattern found for: ${e}`)}return r}(J,Z);if(Z.length>0){let e="",t=[];for(let e of Z){let r=et[e]||{},o=r.buildDir||"",n=/mongo|redis|postgres|mysql|mariadb|memcached/i.test(e)||/mongo|redis|postgres|mysql|mariadb|memcached/i.test(r.image||""),a=e.replace(/^aut|^app/i,"").toLowerCase()||e;r.image&&!o&&n||(o?t.push({svc:e,dir:o,varName:e.toUpperCase().replace(/[^a-zA-Z0-9_]/g,"_")}):t.push({svc:e,guessedSubdir:a,varName:e.toUpperCase().replace(/[^a-zA-Z0-9_]/g,"_")}))}if(t.length>0){for(let r of(e+=`
echo "[$(date +%H:%M:%S)] Building ${t.length} image(s) in parallel..."
`,t)){let t=r.varName;r.dir?e+=`
(
  if docker build -t ${r.svc}:latest ./${r.dir}; then
    echo "[$(date +%H:%M:%S)] ✅ ${r.svc} build complete" > /tmp/${r.svc}_build_result
  else
    echo "[$(date +%H:%M:%S)] ❌ ${r.svc} build FAILED" > /tmp/${r.svc}_build_result
    exit 1
  fi
) &
${t}_BUILD_PID=$!
`:e+=`
(
  if [ -d "${r.guessedSubdir}" ] && [ -f "${r.guessedSubdir}/Dockerfile" ]; then
    if docker build -t ${r.svc}:latest ./${r.guessedSubdir}; then
      echo "[$(date +%H:%M:%S)] ✅ ${r.svc} build complete" > /tmp/${r.svc}_build_result
    else
      echo "[$(date +%H:%M:%S)] ❌ ${r.svc} build FAILED" > /tmp/${r.svc}_build_result
      exit 1
    fi
  elif [ -f "Dockerfile" ]; then
    if docker build -t ${r.svc}:latest ./; then
      echo "[$(date +%H:%M:%S)] ✅ ${r.svc} build complete" > /tmp/${r.svc}_build_result
    else
      echo "[$(date +%H:%M:%S)] ❌ ${r.svc} build FAILED" > /tmp/${r.svc}_build_result
      exit 1
    fi
  else
    echo "[$(date +%H:%M:%S)] ⚠️  ${r.svc}: No Dockerfile found" > /tmp/${r.svc}_build_result
  fi
) &
${t}_BUILD_PID=$!
`}for(let r of(e+=`
# Wait for all builds to complete
`,t))e+=`wait $${r.varName}_BUILD_PID
${r.varName}_BUILD_EXIT=$?
`;for(let r of t)e+=`cat /tmp/${r.svc}_build_result 2>/dev/null
`;e+=`
# Abort if any build failed
`;let r=t.map(e=>`[ $${e.varName}_BUILD_EXIT -ne 0 ]`).join(" || ");e+=`if ${r}; then
  echo "[deploy] ERROR: One or more builds failed — aborting."
  rm -f ${t.map(e=>`/tmp/${e.svc}_build_result`).join(" ")}
  exit 1
fi
rm -f ${t.map(e=>`/tmp/${e.svc}_build_result`).join(" ")}
echo "[$(date +%H:%M:%S)] ✅ All builds complete"
`}let r="";for(let e of Z){let t=et[e]||{},o=t.ports&&t.ports[0]?t.ports[0]:er[e]||"",n=t.image||`${e}:latest`;o?g.logger.info(`[ai-analyze] ${e}: using port ${o}`):g.logger.info(`[ai-analyze] ${e}: no port found — overlay network only`),r+=`deploy_service ${e} ${n} ${o||""}
`}V=`
# set -e intentionally omitted — docker service update exits non-zero during rollback by design

# ── Swarm init (best-effort) ─────────────────────────────────────────────────
docker swarm init 2>/dev/null || true
docker swarm update --task-history-limit 3 2>/dev/null || true

# ── Overlay network (fast) ──────────────────────────────────────────────────
SWARM_NET=$(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v '^ingress$' | head -1)
if [ -z "$SWARM_NET" ]; then
  SWARM_NET="swarm-net"
  docker network create --driver overlay --attachable "$SWARM_NET" 2>/dev/null || SWARM_NET="swarm-overlay"
  docker network create --driver overlay --attachable "$SWARM_NET" 2>/dev/null || true
  # Quick verify - only wait 3 seconds max
  for _i in {1..3}; do
    SWARM_NET=$(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v '^ingress$' | head -1)
    [ -n "$SWARM_NET" ] && break
    sleep 1
  done
  if [ -z "$SWARM_NET" ]; then
    echo "[net] ERROR: No overlay network after 3s. Aborting."
    exit 1
  fi
fi
echo "[net] Network: $SWARM_NET"

# ── Build images ─────────────────────────────────────────────────────────────
${e}

# ── Detect swarm mode ────────────────────────────────────────────────────────
_IS_SWARM=0
if docker node ls >/dev/null 2>&1; then
  _IS_SWARM=1
  echo "[deploy] Swarm mode active."
else
  echo "[deploy] No swarm manager — using standalone container mode."
fi

# ── deploy_service <name> <image> <host_port:container_port> ─────────────────
deploy_service() {
  local NAME="$1"
  local IMAGE="$2"
  local PORT="$3"

  echo ""
  echo "===== Deploy $NAME ====="

  if [ "$_IS_SWARM" = "1" ]; then
    # ── SWARM MODE ──
    # Resolve local image ID if built locally so Swarm detects new build immediately
    LOCAL_IMG_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")

    if docker service inspect "$NAME" >/dev/null 2>&1; then
      echo "[swarm] Updating $NAME with rolling update & rollback safety..."
      docker service update --image "$LOCAL_IMG_ID" --no-resolve-image --force --update-order start-first --update-parallelism 1 --update-delay 5s --update-monitor 15s --update-failure-action rollback --update-max-failure-ratio 0 --rollback-order start-first --rollback-parallelism 1 --rollback-delay 5s --rollback-monitor 15s --stop-grace-period 15s "$NAME" || echo "[swarm] WARNING: $NAME update command reported non-zero — verifying convergence / rollback..."
    else
      if docker inspect "$NAME" >/dev/null 2>&1; then
        echo "[swarm] Migrating $NAME: standalone container → Swarm service..."
        docker stop "$NAME" 2>/dev/null || true
        _HAD_CONTAINER=1
      else
        echo "[swarm] Creating fresh Swarm service $NAME..."
        _HAD_CONTAINER=0
      fi
      PUBLISH_FLAG=""
      [ -n "$PORT" ] && PUBLISH_FLAG="--publish $PORT"
      if docker service create --name "$NAME" --network "$SWARM_NET" $PUBLISH_FLAG --replicas 2 --detach --no-resolve-image --update-order start-first --update-parallelism 1 --update-delay 5s --update-monitor 15s --update-failure-action rollback --update-max-failure-ratio 0 --rollback-order start-first --rollback-parallelism 1 --rollback-delay 5s --rollback-monitor 15s --stop-grace-period 15s "$LOCAL_IMG_ID"; then
        [ "$_HAD_CONTAINER" = "1" ] && docker rm "$NAME" 2>/dev/null || true
      else
        echo "[swarm] ERROR: Failed to create $NAME."
        [ "$_HAD_CONTAINER" = "1" ] && docker start "$NAME" 2>/dev/null || true
        return 1
      fi
    fi

    echo "[swarm] Monitoring health and convergence for $NAME..."
    _CONVERGED=0
    for _i in $(seq 1 30); do
      _UPDATE_STATE=$(docker service inspect "$NAME" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || echo "")
      _FAILED_TASKS=$(docker service ps "$NAME" --filter "desired-state=shutdown" --format '{{.CurrentState}}' 2>/dev/null | grep -c "Failed" || echo "0")
      _RUNNING_TASKS=$(docker service ps "$NAME" --filter "desired-state=running" --format '{{.CurrentState}}' 2>/dev/null | grep -c "Running" || echo "0")

      # If update paused or failed, or new tasks are crashing, trigger / confirm rollback
      if [ "$_UPDATE_STATE" = "paused" ] || [ "$_UPDATE_STATE" = "rollback_started" ] || [ "$_FAILED_TASKS" -ge 2 ]; then
        if [ "$_UPDATE_STATE" != "rollback_started" ] && [ "$_UPDATE_STATE" != "rollback_completed" ]; then
          echo "[swarm] ❌ ERROR: Detected update failure or crashing tasks for $NAME! Initiating automatic rollback..."
          docker service rollback "$NAME" 2>/dev/null || true
        fi
        
        echo "[swarm] ⏳ Waiting for rollback to complete to preserve website uptime..."
        for _rb in $(seq 1 20); do
          _RB_STATE=$(docker service inspect "$NAME" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || echo "")
          _RB_RUNNING=$(docker service ps "$NAME" --filter "desired-state=running" --format '{{.CurrentState}}' 2>/dev/null | grep -c "Running" || echo "0")
          if [ "$_RB_STATE" = "rollback_completed" ] || [ "$_RB_RUNNING" -ge 1 ]; then
            echo "[swarm] 🛡️ Automatic rollback completed! Previous stable version is active ($_RB_RUNNING replica(s) running)."
            docker service ps "$NAME" --no-trunc 2>/dev/null | tail -5
            return 1
          fi
          sleep 2
        done
        echo "[swarm] ⚠️ Rollback in progress. Current state: $_RB_STATE"
        return 1
      fi

      if [ "$_UPDATE_STATE" = "completed" ] && [ "$_RUNNING_TASKS" -ge 1 ]; then
        echo "[swarm] ✅ $NAME deployment completed successfully ($_RUNNING_TASKS replica(s) running healthy)."
        _CONVERGED=1
        return 0
      fi

      echo "[swarm] Waiting for $NAME... ($_i/30) [Status: \${_UPDATE_STATE:-updating}, Running: $_RUNNING_TASKS, Failed: $_FAILED_TASKS]"
      sleep 2
    done
    echo "[swarm] WARNING: $NAME not confirmed after 10s — service may still be converging."
    docker service ps "$NAME" --no-trunc 2>/dev/null | tail -5
    return 0

  else
    # ── STANDALONE MODE ──
    echo "[docker] Deploying $NAME as standalone container..."
    if docker inspect "$NAME" >/dev/null 2>&1; then
      echo "[docker] Stopping and removing existing container $NAME..."
      docker stop "$NAME" 2>/dev/null || true
      docker rm "$NAME" 2>/dev/null || true
    fi
    PORT_FLAG=""
    [ -n "$PORT" ] && PORT_FLAG="-p $PORT"
    if docker run -d --name "$NAME" --restart unless-stopped $PORT_FLAG "$IMAGE"; then
      echo "[docker] $NAME started successfully."
      return 0
    else
      echo "[docker] ERROR: Failed to start $NAME."
      return 1
    fi
  fi
}

# ── Deploy services ──────────────────────────────────────────────────────────
${r}

# ── Reconnect Nginx ───────────────────────────────────────────────────────────
if [ "$_IS_SWARM" = "1" ]; then
  for _net in $(docker network ls --filter driver=overlay --format "{{.Name}}"); do
    docker network connect "$_net" global-nginx 2>/dev/null || docker network connect "$_net" nginx 2>/dev/null || true
  done
fi
docker exec global-nginx nginx -s reload 2>/dev/null || docker restart global-nginx 2>/dev/null || true

# ── Cleanup ───────────────────────────────────────────────────────────────────
docker container prune -f 2>/dev/null || true`}let eo=Y.deployCommand||"",en=eo;if(V){let e=e=>{let t=e.trim();return!!t&&(/^docker\s+build\b/.test(t)||/^docker\s+(service|swarm|stack)\s/.test(t)||/^docker(-compose|\s+compose)\s+(up|down)/.test(t)||/^docker\s+(image|container)\s+prune/.test(t)||/^docker\s+(exec|restart)\s+.*nginx/.test(t)||/^docker\s+network\s+connect/.test(t)||/echo\s+"Deployment completed/.test(t)||/echo\s+'Deployment completed/.test(t)||/^SWARM_NET=/.test(t)||/swarm.*overlay|overlay.*swarm/i.test(t))},t=eo.split("\n"),r=[],o=!1;for(let n of t){let t=n.trim();!o&&(/^docker\s+build\b/.test(t)||/^docker\s+(service|swarm|stack)\s/.test(t)||/^docker(-compose|\s+compose)\s+(up|down)/.test(t)||/^SWARM_NET=/.test(t))&&(o=!0),o||e(n)||r.push(n)}let n=r.join("\n").trimEnd();en=(n?n+"\n\n":"")+V+'\n\necho "Deployment completed successfully."'}let ea=q?en:eo,ei="";if(q&&Z.length>0){let e=Z.filter(e=>!ea.includes(e));e.length>0&&(ei=`⚠️ WARNING: Detected services [${e.join(", ")}] were missing from the generated script. Please check your docker-compose.yml or click "Re-Analyze".`,g.logger.warn(`[ai-analyze] ${ei}`))}let es={projectType:Y.projectType,technologies:Y.technologies,deployCommand:ea,standardScript:eo,swarmScript:en,summary:ei?`${ei}

${Y.summary}`:Y.summary,validationPassed:!ei,detectedServices:Z,analyzedAt:new Date},el=await c.default.findOne({...(0,m.resolveUserIdQuery)(r),key:y}),ec=el?.value||{},ed=Array.isArray(ec.aiLogs)?ec.aiLogs:[];ed.unshift({...es,targetType:N,resolvedPath:b}),ed.length>15&&ed.pop();let eu={...ec,projectPath:b,aiProfile:es,aiLogs:ed};return await c.default.findOneAndUpdate({key:y},{$set:{value:eu}},{upsert:!0}),o.NextResponse.json({success:!0,aiProfile:es,aiLogs:ed})}catch(e){return g.logger.error("[deploy/ai-analyze] POST error:",e.message),o.NextResponse.json({success:!1,error:e.message},{status:500})}}[a,l,f]=h.then?(await h)():h,e.s(["POST",0,v]),r()}catch(e){r(e)}},!1),18960,e=>{"use strict";var t=e.i(8970),r=e.i(74017),o=e.i(96250),n=e.i(59756),a=e.i(61916),i=e.i(74677),s=e.i(69741),l=e.i(16795),c=e.i(87718),d=e.i(95169),u=e.i(47587),p=e.i(66012),m=e.i(70101),f=e.i(26937),g=e.i(10372),h=e.i(93695);e.i(52474);var v=e.i(5232);let y=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/deploy/ai-analyze/route",pathname:"/api/deploy/ai-analyze",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/deploy/ai-analyze/route.js",nextConfigOutput:"",userland:()=>e.r(73721),...{}}),{workAsyncStorage:N,workUnitAsyncStorage:$,serverHooks:A}=y;async function E(e,t,o){o.requestMeta&&(0,n.setRequestMeta)(e,o.requestMeta),y.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let N="/api/deploy/ai-analyze/route";N=N.replace(/\/index$/,"")||"/";let $=await y.prepare(e,t,{srcPage:N,multiZoneDraftMode:!1});if(!$)return t.statusCode=400,t.end("Bad Request"),null==o.waitUntil||o.waitUntil.call(o,Promise.resolve()),null;let{buildId:A,deploymentId:E,params:_,nextConfig:R,parsedUrl:S,isDraftMode:k,prerenderManifest:x,routerServerContext:b,isOnDemandRevalidate:w,revalidateOnlyGenerated:I,resolvedPathname:T,clientReferenceManifest:O,serverActionsManifest:C}=$,M=(0,s.normalizeAppPath)(N),D=!!(x.dynamicRoutes[M]||x.routes[T]),P=async()=>((null==b?void 0:b.render404)?await b.render404(e,t,S,!1):t.end("This page could not be found"),null);if(D&&!k){let e=!!x.routes[T],t=x.dynamicRoutes[M];if(t&&!1===t.fallback&&!e){if(R.adapterPath)return await P();throw new h.NoFallbackError}}let U=null;!D||y.isDev||k||(U="/index"===(U=T)?"/":U);let L=!0===y.isDev||!D,j=D&&!L;C&&O&&(0,i.setManifestsSingleton)({page:N,clientReferenceManifest:O,serverActionsManifest:C});let G=e.method||"GET",z=(0,a.getTracer)(),H=z.getActiveScopeSpan(),F=!!(null==b?void 0:b.isWrappedByNextServer),K=!!(0,n.getRequestMeta)(e,"minimalMode"),q=(0,n.getRequestMeta)(e,"incrementalCache")||await y.getIncrementalCache(e,R,x,K);null==q||q.resetRequestCache(),globalThis.__incrementalCache=q;let B={params:_,previewProps:x.preview,renderOpts:{experimental:{authInterrupts:!!R.experimental.authInterrupts,useCacheTimeout:R.experimental.useCacheTimeout},cacheComponents:!!R.cacheComponents,validationLevel:R.experimental.instantInsights.validationLevel,supportsDynamicResponse:L,incrementalCache:q,hmrRefreshHash:(0,n.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:R.cacheLife,staticPageGenerationTimeout:R.staticPageGenerationTimeout,waitUntil:o.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,o,n)=>y.onRequestError(e,t,o,n,b)},sharedContext:{buildId:A,deploymentId:E}},W=new l.NodeNextRequest(e),X=new l.NodeNextResponse(t),Y=c.NextRequestAdapter.fromNodeNextRequest(W,(0,c.signalFromNodeResponse)(t)),V=async({previousCacheEntry:r})=>{try{if(!K&&w&&I&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await y.handle(Y,B);e.fetchMetrics=B.renderOpts.fetchMetrics;let a=B.renderOpts.pendingWaitUntil;a&&o.waitUntil&&(o.waitUntil(a),a=void 0);let i=B.renderOpts.collectedTags;if(!D)return await (0,p.sendResponse)(W,X,n,a),null;{let e=await n.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(n.headers);i&&(t[g.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==B.renderOpts.collectedRevalidate&&!(B.renderOpts.collectedRevalidate>=g.INFINITE_CACHE)&&B.renderOpts.collectedRevalidate,o=void 0===B.renderOpts.collectedExpire||B.renderOpts.collectedExpire>=g.INFINITE_CACHE?!1!==r&&r>0?R.expireTime:void 0:B.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:o}}}}catch(t){throw(null==r?void 0:r.isStale)&&await y.onRequestError(e,t,{routerKind:"App Router",routePath:N,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:w})},!1,b),t}},Z=async(n,i)=>{try{var s,l;let n=await y.handleResponse({req:e,nextConfig:R,cacheKey:U,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:x,isRoutePPREnabled:!1,isOnDemandRevalidate:w,revalidateOnlyGenerated:I,responseGenerator:V,waitUntil:o.waitUntil,isMinimalMode:K});if(!D)return;if((null==n||null==(s=n.value)?void 0:s.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==n||null==(l=n.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});K||t.setHeader("x-nextjs-cache",w?"REVALIDATED":n.isMiss?"MISS":n.isStale?"STALE":"HIT"),k&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let a=(0,m.fromNodeOutgoingHttpHeaders)(n.value.headers);K&&D||a.delete(g.NEXT_CACHE_TAGS_HEADER),!n.cacheControl||t.getHeader("Cache-Control")||a.get("Cache-Control")||a.set("Cache-Control",(0,f.getCacheControlHeader)(n.cacheControl)),await (0,p.sendResponse)(W,X,new Response(n.value.body,{headers:a,status:n.value.status||200}));return}catch(t){if(t instanceof h.NoFallbackError||await y.onRequestError(e,t,{routerKind:"App Router",routePath:M,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:w})},!1,b),D)throw t;await (0,p.sendResponse)(W,X,new Response(null,{status:500}));return}finally{(()=>{if(!n)return;let e=t.statusCode;n.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(n.setStatus({code:a.SpanStatusCode.ERROR}),n.setAttribute("error.type",e.toString()));let r=z.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let o=r.get("next.route")||M,s=`${G} ${o}`;n.setAttributes({"next.route":o,"http.route":o,"next.span_name":s}),n.updateName(s),i&&i!==n&&(i.setAttribute("http.route",o),i.updateName(s))})()}};if(F&&H)await Z(H,void 0);else{let t=z.getActiveScopeSpan();await z.withPropagatedContext(e.headers,()=>z.trace(d.BaseServerSpan.handleRequest,{spanName:`${G} ${N}`,kind:a.SpanKind.SERVER,attributes:{"http.method":G,"http.target":e.url}},e=>Z(e,t)),void 0,!F)}}e.s(["handler",0,E,"patchFetch",0,function(){return(0,o.patchFetch)({workAsyncStorage:N,workUnitAsyncStorage:$})},"routeModule",0,y,"serverHooks",0,A,"workAsyncStorage",0,N,"workUnitAsyncStorage",0,$])}];

//# sourceMappingURL=_0--34t0._.js.map