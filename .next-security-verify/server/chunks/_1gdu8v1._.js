module.exports=[34959,e=>e.a(async(t,n)=>{try{var o=e.i(89171),r=e.i(23667),s=e.i(80533),i=e.i(47185),a=e.i(51631),l=t([s,i]);[s,i]=l.then?(await l)():l;let p=`
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"
_cmd() { command -v "$1" >/dev/null 2>&1; }
_sudo() { sudo -n true 2>/dev/null && echo 1 || echo 0; }
HAS_SUDO="$(_sudo)"

# ── Docker ──────────────────────────────────────────────────────────────────
echo "===DOCKER==="
if _cmd docker; then
  VER_RAW="$(docker --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'Docker version K[0-9]+.[0-9]+.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(systemctl is-active docker 2>/dev/null || \
            service docker status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (docker info >/dev/null 2>&1 && echo 'running') || echo 'unknown')"
  CONTAINERS="$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
  CONTAINERS_ALL="$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
  echo "CONTAINERS_RUNNING=$CONTAINERS"
  echo "CONTAINERS_TOTAL=$CONTAINERS_ALL"
elif [ "$HAS_SUDO" = "1" ] && sudo -n docker --version >/dev/null 2>&1; then
  VER_RAW="$(sudo -n docker --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'Docker version K[0-9]+.[0-9]+.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(sudo -n systemctl is-active docker 2>/dev/null || echo 'unknown')"
  CONTAINERS="$(sudo -n docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
  CONTAINERS_ALL="$(sudo -n docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
  echo "CONTAINERS_RUNNING=$CONTAINERS"
  echo "CONTAINERS_TOTAL=$CONTAINERS_ALL"
else
  echo "INSTALLED=false"
fi

# ── Docker Compose ───────────────────────────────────────────────────────────
echo "===DOCKER_COMPOSE==="
if _cmd docker-compose; then
  VER_RAW="$(docker-compose --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP '(version |v)?K[0-9]+.[0-9]+.[0-9]+' || echo "$VER_RAW")"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
elif docker compose version >/dev/null 2>&1; then
  VER_RAW="$(docker compose version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP '(version |v)?K[0-9]+.[0-9]+.[0-9]+' || echo "$VER_RAW")"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
else
  echo "INSTALLED=false"
fi

# ── Nginx ────────────────────────────────────────────────────────────────────
echo "===NGINX==="
NGINX_BIN=""
for _p in "/usr/sbin/nginx" "/usr/local/sbin/nginx" "/snap/bin/nginx"; do
  [ -x "$_p" ] && NGINX_BIN="$_p" && break
done
[ -z "$NGINX_BIN" ] && NGINX_BIN="$(command -v nginx 2>/dev/null)"
if [ -n "$NGINX_BIN" ]; then
  VER_RAW="$($NGINX_BIN -v 2>&1 | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'nginx/(version /)?K[0-9]+.[0-9]+.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(systemctl is-active nginx 2>/dev/null || \
            service nginx status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x nginx >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  CONFIG="$($NGINX_BIN -T 2>/dev/null | grep -m1 'configuration file' | awk '{print $NF}' | tr -d ';' || echo '/etc/nginx/nginx.conf')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
  echo "CONFIG=$CONFIG"
else
  echo "INSTALLED=false"
fi

# ── MongoDB ──────────────────────────────────────────────────────────────────
echo "===MONGODB==="
MONGO_BIN=""
for _p in "/usr/bin/mongod" "/usr/local/bin/mongod" "/opt/homebrew/bin/mongod"; do
  [ -x "$_p" ] && MONGO_BIN="$_p" && break
done
[ -z "$MONGO_BIN" ] && MONGO_BIN="$(command -v mongod 2>/dev/null)"
if [ -n "$MONGO_BIN" ]; then
  VER_RAW="$($MONGO_BIN --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'version v?K[0-9]+.[0-9]+.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(systemctl is-active mongod 2>/dev/null || \
            service mongod status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x mongod >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── MySQL / MariaDB ───────────────────────────────────────────────────────────
echo "===MYSQL==="
if _cmd mysqld || _cmd mysqld_safe || _cmd mariadbd; then
  BIN="$(command -v mysqld 2>/dev/null || command -v mariadbd 2>/dev/null)"
  VER="$(mysql --version 2>/dev/null | head -1 || mariadb --version 2>/dev/null | head -1 || $BIN --version 2>/dev/null | head -1)"
  STATUS="$(systemctl is-active mysql 2>/dev/null || \
            systemctl is-active mariadb 2>/dev/null || \
            service mysql status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x mysqld >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── PostgreSQL ────────────────────────────────────────────────────────────────
echo "===POSTGRESQL==="
if _cmd pg_ctl || _cmd postgres; then
  VER="$(postgres --version 2>/dev/null | head -1 || pg_ctl --version 2>/dev/null | head -1)"
  STATUS="$(systemctl is-active postgresql 2>/dev/null || \
            service postgresql status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x postgres >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
echo "===REDIS==="
if _cmd redis-server; then
  VER="$(redis-server --version 2>/dev/null | head -1)"
  STATUS="$(systemctl is-active redis 2>/dev/null || \
            systemctl is-active redis-server 2>/dev/null || \
            service redis-server status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (redis-cli ping >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
echo "===NODEJS==="
NODE_BIN="$(command -v node 2>/dev/null || command -v nodejs 2>/dev/null)"
if [ -n "$NODE_BIN" ]; then
  VER="$($NODE_BIN --version 2>/dev/null)"
  NPM_VER="$(npm --version 2>/dev/null)"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "NPM_VERSION=$NPM_VER"
else
  echo "INSTALLED=false"
fi

# ── Python ────────────────────────────────────────────────────────────────────
echo "===PYTHON==="
PYTHON_BIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null)"
if [ -n "$PYTHON_BIN" ]; then
  VER="$($PYTHON_BIN --version 2>&1 | head -1)"
  PIP_VER="$(pip3 --version 2>/dev/null | head -1 || pip --version 2>/dev/null | head -1)"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "PIP_VERSION=$PIP_VER"
else
  echo "INSTALLED=false"
fi

# ── PHP ───────────────────────────────────────────────────────────────────────
echo "===PHP==="
if _cmd php; then
  echo "INSTALLED=true"
  echo "VERSION=$(php -r 'echo PHP_VERSION;' 2>/dev/null)"
else
  echo "INSTALLED=false"
fi

# ── Java ──────────────────────────────────────────────────────────────────────
echo "===JAVA==="
if _cmd java; then
  echo "INSTALLED=true"
  echo "VERSION=$(java -version 2>&1 | head -1)"
else
  echo "INSTALLED=false"
fi

# ── Go ────────────────────────────────────────────────────────────────────────
echo "===GO==="
if _cmd go; then
  echo "INSTALLED=true"
  echo "VERSION=$(go version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

# ── Rust / Cargo ──────────────────────────────────────────────────────────────
echo "===RUST==="
if _cmd rustc; then
  echo "INSTALLED=true"
  echo "VERSION=$(rustc --version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

# ── Git ───────────────────────────────────────────────────────────────────────
echo "===GIT==="
if _cmd git; then
  echo "INSTALLED=true"
  echo "VERSION=$(git --version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

# ── rclone ────────────────────────────────────────────────────────────────────
echo "===RCLONE==="
RCLONE_BIN="$(command -v rclone 2>/dev/null || ls "$HOME/.local/bin/rclone" 2>/dev/null)"
if [ -n "$RCLONE_BIN" ] && [ -x "$RCLONE_BIN" ]; then
  echo "INSTALLED=true"
  echo "VERSION=$($RCLONE_BIN version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

echo "===DONE==="
`;function c(e,t){let n=RegExp(`===${t}===\\n([\\s\\S]*?)(?====[A-Z_]+=|$)`);return e.match(n)?.[1]||""}function d(e){let t={};for(let n of e.split("\n")){let e=n.indexOf("=");if(e<0)continue;let o=n.slice(0,e).trim(),r=n.slice(e+1).trim();o&&(t[o]=r)}return t}function u(e,t,n={}){if("true"!==t.INSTALLED)return{name:e,installed:!1};let o={name:e,installed:!0,version:t.VERSION||null,...n};return t.STATUS&&(o.status=t.STATUS),o}async function h(e){try{if(!await (0,r.getServerSession)(s.authOptions))return o.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let{searchParams:t}=new URL(e.url),n=t.get("connectionId");if(!n)return o.NextResponse.json({success:!1,error:"Missing connectionId"},{status:400});let l=await (0,i.getSshConfig)(n),h=await (0,i.execCommand)(l,p);if(a.logger.info("[server-monitor/apps] SSH result:",{code:h.code,stdoutLength:h.stdout?.length||0,stderrLength:h.stderr?.length||0}),0!==h.code&&!h.stdout)return a.logger.error("[server-monitor/apps] Command failed:",h.stderr),o.NextResponse.json({success:!1,error:h.stderr||"Failed to detect applications"},{status:500});let N=h.stdout||"";a.logger.info("[server-monitor/apps] Output preview:",N.substring(0,500));let R=d(c(N,"DOCKER")),v=u("Docker",R,{containersRunning:parseInt(R.CONTAINERS_RUNNING||"0",10),containersTotal:parseInt(R.CONTAINERS_TOTAL||"0",10)}),E=d(c(N,"DOCKER_COMPOSE")),S=u("Docker Compose",E),T=d(c(N,"NGINX")),I=u("Nginx",T,{configFile:T.CONFIG||null}),A=d(c(N,"MONGODB")),m=u("MongoDB",A),g=d(c(N,"MYSQL")),O=u("MySQL / MariaDB",g),f=d(c(N,"POSTGRESQL")),$=u("PostgreSQL",f),_=d(c(N,"REDIS")),L=u("Redis",_),C=d(c(N,"NODEJS")),V=u("Node.js",C,{npmVersion:C.NPM_VERSION||null}),D=d(c(N,"PYTHON")),P=u("Python",D,{pipVersion:D.PIP_VERSION||null}),x=d(c(N,"PHP")),y=u("PHP",x),w=d(c(N,"JAVA")),U=u("Java",w),b=d(c(N,"GO")),k=u("Go",b),G=d(c(N,"RUST")),M=u("Rust",G),B=d(c(N,"GIT")),H=u("Git",B),q=d(c(N,"RCLONE")),W=u("rclone",q),j=[v,S,I,m,O,$,L,V,P,y,U,k,M,H,W];return o.NextResponse.json({success:!0,timestamp:new Date().toISOString(),apps:j,installed:j.filter(e=>e.installed).map(e=>e.name)})}catch(e){return a.logger.error("[server-monitor/apps] error:",e.message),o.NextResponse.json({success:!1,error:e.message},{status:500})}}e.s(["GET",0,h]),n()}catch(e){n(e)}},!1),21926,e=>{"use strict";var t=e.i(8970),n=e.i(74017),o=e.i(96250),r=e.i(59756),s=e.i(61916),i=e.i(74677),a=e.i(69741),l=e.i(16795),c=e.i(87718),d=e.i(95169),u=e.i(47587),h=e.i(66012),p=e.i(70101),N=e.i(26937),R=e.i(10372),v=e.i(93695);e.i(52474);var E=e.i(5232);let S=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/server-monitor/apps/route",pathname:"/api/server-monitor/apps",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/server-monitor/apps/route.js",nextConfigOutput:"",userland:()=>e.r(34959),...{}}),{workAsyncStorage:T,workUnitAsyncStorage:I,serverHooks:A}=S;async function m(e,t,o){o.requestMeta&&(0,r.setRequestMeta)(e,o.requestMeta),S.isDev&&(0,r.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let T="/api/server-monitor/apps/route";T=T.replace(/\/index$/,"")||"/";let I=await S.prepare(e,t,{srcPage:T,multiZoneDraftMode:!1});if(!I)return t.statusCode=400,t.end("Bad Request"),null==o.waitUntil||o.waitUntil.call(o,Promise.resolve()),null;let{buildId:A,deploymentId:m,params:g,nextConfig:O,parsedUrl:f,isDraftMode:$,prerenderManifest:_,routerServerContext:L,isOnDemandRevalidate:C,revalidateOnlyGenerated:V,resolvedPathname:D,clientReferenceManifest:P,serverActionsManifest:x}=I,y=(0,a.normalizeAppPath)(T),w=!!(_.dynamicRoutes[y]||_.routes[D]),U=async()=>((null==L?void 0:L.render404)?await L.render404(e,t,f,!1):t.end("This page could not be found"),null);if(w&&!$){let e=!!_.routes[D],t=_.dynamicRoutes[y];if(t&&!1===t.fallback&&!e){if(O.adapterPath)return await U();throw new v.NoFallbackError}}let b=null;!w||S.isDev||$||(b="/index"===(b=D)?"/":b);let k=!0===S.isDev||!w,G=w&&!k;x&&P&&(0,i.setManifestsSingleton)({page:T,clientReferenceManifest:P,serverActionsManifest:x});let M=e.method||"GET",B=(0,s.getTracer)(),H=B.getActiveScopeSpan(),q=!!(null==L?void 0:L.isWrappedByNextServer),W=!!(0,r.getRequestMeta)(e,"minimalMode"),j=(0,r.getRequestMeta)(e,"incrementalCache")||await S.getIncrementalCache(e,O,_,W);null==j||j.resetRequestCache(),globalThis.__incrementalCache=j;let K={params:g,previewProps:_.preview,renderOpts:{experimental:{authInterrupts:!!O.experimental.authInterrupts,useCacheTimeout:O.experimental.useCacheTimeout},cacheComponents:!!O.cacheComponents,validationLevel:O.experimental.instantInsights.validationLevel,supportsDynamicResponse:k,incrementalCache:j,hmrRefreshHash:(0,r.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:O.cacheLife,staticPageGenerationTimeout:O.staticPageGenerationTimeout,waitUntil:o.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,o,r)=>S.onRequestError(e,t,o,r,L)},sharedContext:{buildId:A,deploymentId:m}},F=new l.NodeNextRequest(e),X=new l.NodeNextResponse(t),Q=c.NextRequestAdapter.fromNodeNextRequest(F,(0,c.signalFromNodeResponse)(t)),Y=async({previousCacheEntry:n})=>{try{if(!W&&C&&V&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await S.handle(Q,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let s=K.renderOpts.pendingWaitUntil;s&&o.waitUntil&&(o.waitUntil(s),s=void 0);let i=K.renderOpts.collectedTags;if(!w)return await (0,h.sendResponse)(F,X,r,s),null;{let e=await r.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(r.headers);i&&(t[R.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=R.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,o=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=R.INFINITE_CACHE?!1!==n&&n>0?O.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:E.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:o}}}}catch(t){throw(null==n?void 0:n.isStale)&&await S.onRequestError(e,t,{routerKind:"App Router",routePath:T,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:G,isOnDemandRevalidate:C})},!1,L),t}},J=async(r,i)=>{try{var a,l;let r=await S.handleResponse({req:e,nextConfig:O,cacheKey:b,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:_,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:V,responseGenerator:Y,waitUntil:o.waitUntil,isMinimalMode:W});if(!w)return;if((null==r||null==(a=r.value)?void 0:a.kind)!==E.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==r||null==(l=r.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});W||t.setHeader("x-nextjs-cache",C?"REVALIDATED":r.isMiss?"MISS":r.isStale?"STALE":"HIT"),$&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let s=(0,p.fromNodeOutgoingHttpHeaders)(r.value.headers);W&&w||s.delete(R.NEXT_CACHE_TAGS_HEADER),!r.cacheControl||t.getHeader("Cache-Control")||s.get("Cache-Control")||s.set("Cache-Control",(0,N.getCacheControlHeader)(r.cacheControl)),await (0,h.sendResponse)(F,X,new Response(r.value.body,{headers:s,status:r.value.status||200}));return}catch(t){if(t instanceof v.NoFallbackError||await S.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:G,isOnDemandRevalidate:C})},!1,L),w)throw t;await (0,h.sendResponse)(F,X,new Response(null,{status:500}));return}finally{(()=>{if(!r)return;let e=t.statusCode;r.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(r.setStatus({code:s.SpanStatusCode.ERROR}),r.setAttribute("error.type",e.toString()));let n=B.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let o=n.get("next.route")||y,a=`${M} ${o}`;r.setAttributes({"next.route":o,"http.route":o,"next.span_name":a}),r.updateName(a),i&&i!==r&&(i.setAttribute("http.route",o),i.updateName(a))})()}};if(q&&H)await J(H,void 0);else{let t=B.getActiveScopeSpan();await B.withPropagatedContext(e.headers,()=>B.trace(d.BaseServerSpan.handleRequest,{spanName:`${M} ${T}`,kind:s.SpanKind.SERVER,attributes:{"http.method":M,"http.target":e.url}},e=>J(e,t)),void 0,!q)}}e.s(["handler",0,m,"patchFetch",0,function(){return(0,o.patchFetch)({workAsyncStorage:T,workUnitAsyncStorage:I})},"routeModule",0,S,"serverHooks",0,A,"workAsyncStorage",0,T,"workUnitAsyncStorage",0,I])}];

//# sourceMappingURL=_1gdu8v1._.js.map