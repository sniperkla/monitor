module.exports=[1897,e=>e.a(async(t,o)=>{try{var r=e.i(89171),a=e.i(23667),n=e.i(80533),s=e.i(47185),i=e.i(71847),l=e.i(54799),u=e.i(51631),d=t([n,s,i]);async function c(e){try{let t=await (0,a.getServerSession)(n.authOptions);if(!t?.user?.id)return r.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let{sourceConnectionId:o,sourceFilePath:d,sourceFileRef:c,targetConnectionId:p,dryRun:m}=await e.json();if(!o||!p)return r.NextResponse.json({success:!1,error:"Missing sourceConnectionId or targetConnectionId"},{status:400});let h=d||null;if(!h&&c&&!(h=await (0,i.resolveBackupPath)(t.user.id,{connectionId:o,fileRef:c})))return r.NextResponse.json({success:!1,error:"Source backup not found"},{status:404});if(!h)return r.NextResponse.json({success:!1,error:"Missing sourceFilePath or sourceFileRef"},{status:400});let g=l.default.randomUUID().substring(0,8),f=await (0,s.getSshConfig)(o),R=await (0,s.getSshConfig)(p),v=`/tmp/docker_restore_${g}.tar.gz`,$=`/tmp/docker_restore_${g}`;u.logger.info(`[restore-docker] High-speed direct streaming ${h} from source to target...`),await (0,s.sftpTransfer)(f,h,R,v);let E=`
set -e
DOCKER="docker"; if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
mkdir -p ${$}
tar -xzf ${v} -C ${$}

echo "---DISCOVERY---"
echo "HAS_IMAGES=$([ -f ${$}/images.tar.gz ] && echo yes || echo no)"
echo "VOLUME_TARS=$(ls ${$}/vol_*.tar 2>/dev/null | wc -l)"
echo "INSPECT_FILES=$(ls ${$}/inspect_*.json 2>/dev/null | wc -l)"
echo "HAS_COMPOSE=$([ -f ${$}/docker-compose.yml ] || [ -f ${$}/docker-compose.yaml ] || [ -f ${$}/compose.yml ] || [ -f ${$}/compose.yaml ] && echo yes || echo no)"
echo "INSPECT_LIST=$(ls ${$}/inspect_*.json 2>/dev/null | xargs -I{} basename {} .json | sed 's/inspect_//' | tr '\\n' ',')"
echo "VOLUME_LIST=$(ls ${$}/vol_*.tar 2>/dev/null | xargs -I{} basename {} .tar | sed "s/vol_[^_]*_//" | tr '\\n' ',')"
echo "---END---"
`,C=(await (0,s.execCommand)(R,E)).stdout,_=C.includes("HAS_IMAGES=yes"),S=parseInt(C.match(/VOLUME_TARS=(\d+)/)?.[1]||"0"),A=parseInt(C.match(/INSPECT_FILES=(\d+)/)?.[1]||"0"),w=C.includes("HAS_COMPOSE=yes"),y=(C.match(/INSPECT_LIST=(.*)/)?.[1]||"").split(",").filter(Boolean),I=(C.match(/VOLUME_LIST=(.*)/)?.[1]||"").split(",").filter(Boolean);if(0===A&&!w)return r.NextResponse.json({success:!1,error:"No Docker containers or compose files found in backup"},{status:400});let O=`#!/bin/bash
set -e
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
LOG=""
log() { echo "[restore] $1"; LOG="$LOG\\n$1"; }

`;if(_&&(O+=`
log "Loading Docker images..."
$DOCKER load -i ${$}/images.tar.gz 2>&1 | while read line; do log "  $line"; done
log "Images loaded."
`),S>0&&(O+=`
log "Restoring ${S} volume(s)..."
for VOL_TAR in ${$}/vol_*.tar; do
  VOL_NAME=$(basename "$VOL_TAR" .tar | sed "s/vol_[^_]*_//")
  log "  Creating volume: $VOL_NAME"
  $DOCKER volume create "$VOL_NAME" 2>/dev/null || true
  $DOCKER run --rm -v "$VOL_NAME":/dst -v "$(dirname "$VOL_TAR")":/src alpine sh -c "cd /dst && tar xf /src/$(basename "$VOL_TAR") --strip-components=0" 2>&1
  log "  Volume $VOL_NAME restored."
done
`),A>0)for(let e of(O+=`
log "Recreating ${A} container(s)..."
`,y))/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(e)&&(O+=`
# --- Container: ${e} ---
if [ -f ${$}/inspect_${e}.json ]; then
  OLD_STATE=$($DOCKER inspect -f '{{.State.Status}}' "${e}" 2>/dev/null || echo "missing")
  if [ "$OLD_STATE" != "missing" ]; then
    log "  Stopping existing container: ${e}"
    $DOCKER stop "${e}" 2>/dev/null || true
    $DOCKER rm "${e}" 2>/dev/null || true
  fi

  # Extract config from inspect JSON
  IMAGE=$($DOCKER inspect -f '{{.Config.Image}}' "${e}" 2>/dev/null || cat ${$}/inspect_${e}.json | grep -o '"Image": *"[^"]*"' | head -1 | sed 's/"Image": *"//;s/"//')
  if [ -z "$IMAGE" ]; then
    log "  WARNING: Could not determine image for ${e}, skipping."
  else
    # Check if image exists locally
    if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
      log "  Image $IMAGE not found locally, attempting pull..."
      $DOCKER pull "$IMAGE" 2>&1 | tail -1
    fi

    # Build docker run arguments as a Bash array. The backup archive controls
    # every value below, so never concatenate them into a command string or use
    # eval: env values, bind paths, image names, and commands may contain shell
    # metacharacters.
    INSPECT_FILE="${$}/inspect_${e}.json"
    RUN_ARGS=()
    while IFS= read -r -d '' ARG; do RUN_ARGS+=("$ARG"); done < <(python3 - "$INSPECT_FILE" <<'PY'
import json, sys

def emit(value):
    sys.stdout.buffer.write(str(value).encode('utf-8', 'surrogateescape') + b'\0')

with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
config = data.get('Config', {}) or {}
host = data.get('HostConfig', {}) or {}
for value in config.get('Env', []) or []:
    if value and not value.startswith('PATH='):
        emit('-e'); emit(value)
for container_port, bindings in (host.get('PortBindings', {}) or {}).items():
    cp = str(container_port).split('/')[0]
    for binding in bindings or []:
        hp = binding.get('HostPort', '')
        hip = binding.get('HostIp', '0.0.0.0')
        if hp:
            emit('-p'); emit(f'{hip}:{hp}:{cp}' if hip and hip != '0.0.0.0' else f'{hp}:{cp}')
for value in host.get('Binds', []) or []:
    if value:
        emit('-v'); emit(value)
for mount in data.get('Mounts', []) or []:
    if mount.get('Type') == 'volume' and mount.get('Name') and mount.get('Destination'):
        emit('-v'); emit(f"{mount['Name']}:{mount['Destination']}")
network = host.get('NetworkMode', 'default')
if network and network != 'default':
    emit('--network'); emit(network)
restart = host.get('RestartPolicy', {}) or {}
restart_name = restart.get('Name', 'no')
if restart_name and restart_name != 'no':
    value = restart_name
    if restart.get('MaximumRetryCount', 0):
        value = f"{value}:{restart['MaximumRetryCount']}"
    emit('--restart'); emit(value)
hostname = config.get('Hostname', '')
if hostname:
    emit('--hostname'); emit(hostname)
emit('--name'); emit(sys.argv[1].rsplit('/inspect_', 1)[-1].rsplit('.json', 1)[0])
PY
)
    CMD=()
    while IFS= read -r -d '' ARG; do CMD+=("$ARG"); done < <(python3 - "$INSPECT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
for value in data.get('Config', {}).get('Cmd', []) or []:
    sys.stdout.buffer.write(str(value).encode('utf-8', 'surrogateescape') + b'\0')
PY
)

    log "  Starting container: ${e} (image: $IMAGE)"
    log "  Args: \${#RUN_ARGS[@]} arguments"
    $DOCKER run -d "\${RUN_ARGS[@]}" "$IMAGE" "\${CMD[@]}" 2>&1 | while read line; do log "    $line"; done
    log "  Container ${e} started."
  fi
else
  log "  WARNING: inspect file not found for ${e}"
fi
`);if(O+=`
log "Cleaning up temporary files..."
rm -rf ${$} ${v}
log "Docker restore complete!"
echo "---RESULT---"
echo "$LOG"
echo "---END---"
`,m)return r.NextResponse.json({success:!0,dryRun:!0,discovery:{hasImages:_,volumeCount:S,inspectCount:A,hasCompose:w,containers:y,volumes:I},message:`Found ${A} container(s), ${S} volume(s), images: ${_?"yes":"no"}, compose: ${w?"yes":"no"}`});let N=`/tmp/docker_restore_${g}.sh`,T=shellQuote(N),x=`printf '%s' ${shellQuote(Buffer.from(O,"utf8").toString("base64"))} | base64 -d > ${T} && chmod +x ${T}`;await (0,s.execCommand)(R,x);let b=await (0,s.execCommand)(R,`bash ${T} 2>&1; echo "EXIT_CODE=$?"`),k=b.stdout.match(/EXIT_CODE=(\d+)/)?.[1],P=b.stdout.match(/---RESULT---\n([\s\S]*?)---END---/)?.[1]?.trim();return await (0,s.execCommand)(R,`rm -f ${T}`),r.NextResponse.json({success:"0"===k,logs:P||b.stdout,exitCode:parseInt(k||"1")})}catch(e){return u.logger.error("[restore-docker] error:",e.message),r.NextResponse.json({success:!1,error:e.message},{status:500})}}[n,s,i]=d.then?(await d)():d,e.s(["POST",0,c]),o()}catch(e){o(e)}},!1),25203,e=>{"use strict";var t=e.i(8970),o=e.i(74017),r=e.i(96250),a=e.i(59756),n=e.i(61916),s=e.i(74677),i=e.i(69741),l=e.i(16795),u=e.i(87718),d=e.i(95169),c=e.i(47587),p=e.i(66012),m=e.i(70101),h=e.i(26937),g=e.i(10372),f=e.i(93695);e.i(52474);var R=e.i(5232);let v=new t.AppRouteRouteModule({definition:{kind:o.RouteKind.APP_ROUTE,page:"/api/server-backup/restore-docker/route",pathname:"/api/server-backup/restore-docker",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/server-backup/restore-docker/route.js",nextConfigOutput:"",userland:()=>e.r(1897),...{}}),{workAsyncStorage:$,workUnitAsyncStorage:E,serverHooks:C}=v;async function _(e,t,r){r.requestMeta&&(0,a.setRequestMeta)(e,r.requestMeta),v.isDev&&(0,a.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let $="/api/server-backup/restore-docker/route";$=$.replace(/\/index$/,"")||"/";let E=await v.prepare(e,t,{srcPage:$,multiZoneDraftMode:!1});if(!E)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:C,deploymentId:_,params:S,nextConfig:A,parsedUrl:w,isDraftMode:y,prerenderManifest:I,routerServerContext:O,isOnDemandRevalidate:N,revalidateOnlyGenerated:T,resolvedPathname:x,clientReferenceManifest:b,serverActionsManifest:k}=E,P=(0,i.normalizeAppPath)($),M=!!(I.dynamicRoutes[P]||I.routes[x]),D=async()=>((null==O?void 0:O.render404)?await O.render404(e,t,w,!1):t.end("This page could not be found"),null);if(M&&!y){let e=!!I.routes[x],t=I.dynamicRoutes[P];if(t&&!1===t.fallback&&!e){if(A.adapterPath)return await D();throw new f.NoFallbackError}}let L=null;!M||v.isDev||y||(L="/index"===(L=x)?"/":L);let H=!0===v.isDev||!M,j=M&&!H;k&&b&&(0,s.setManifestsSingleton)({page:$,clientReferenceManifest:b,serverActionsManifest:k});let G=e.method||"GET",U=(0,n.getTracer)(),K=U.getActiveScopeSpan(),q=!!(null==O?void 0:O.isWrappedByNextServer),F=!!(0,a.getRequestMeta)(e,"minimalMode"),V=(0,a.getRequestMeta)(e,"incrementalCache")||await v.getIncrementalCache(e,A,I,F);null==V||V.resetRequestCache(),globalThis.__incrementalCache=V;let B={params:S,previewProps:I.preview,renderOpts:{experimental:{authInterrupts:!!A.experimental.authInterrupts,useCacheTimeout:A.experimental.useCacheTimeout},cacheComponents:!!A.cacheComponents,validationLevel:A.experimental.instantInsights.validationLevel,supportsDynamicResponse:H,incrementalCache:V,hmrRefreshHash:(0,a.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:A.cacheLife,staticPageGenerationTimeout:A.staticPageGenerationTimeout,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,o,r,a)=>v.onRequestError(e,t,r,a,O)},sharedContext:{buildId:C,deploymentId:_}},z=new l.NodeNextRequest(e),X=new l.NodeNextResponse(t),Y=u.NextRequestAdapter.fromNodeNextRequest(z,(0,u.signalFromNodeResponse)(t)),W=async({previousCacheEntry:o})=>{try{if(!F&&N&&T&&!o)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let a=await v.handle(Y,B);e.fetchMetrics=B.renderOpts.fetchMetrics;let n=B.renderOpts.pendingWaitUntil;n&&r.waitUntil&&(r.waitUntil(n),n=void 0);let s=B.renderOpts.collectedTags;if(!M)return await (0,p.sendResponse)(z,X,a,n),null;{let e=await a.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(a.headers);s&&(t[g.NEXT_CACHE_TAGS_HEADER]=s),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let o=void 0!==B.renderOpts.collectedRevalidate&&!(B.renderOpts.collectedRevalidate>=g.INFINITE_CACHE)&&B.renderOpts.collectedRevalidate,r=void 0===B.renderOpts.collectedExpire||B.renderOpts.collectedExpire>=g.INFINITE_CACHE?!1!==o&&o>0?A.expireTime:void 0:B.renderOpts.collectedExpire;return{value:{kind:R.CachedRouteKind.APP_ROUTE,status:a.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:o,expire:r}}}}catch(t){throw(null==o?void 0:o.isStale)&&await v.onRequestError(e,t,{routerKind:"App Router",routePath:$,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:N})},!1,O),t}},Z=async(a,s)=>{try{var i,l;let a=await v.handleResponse({req:e,nextConfig:A,cacheKey:L,routeKind:o.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:I,isRoutePPREnabled:!1,isOnDemandRevalidate:N,revalidateOnlyGenerated:T,responseGenerator:W,waitUntil:r.waitUntil,isMinimalMode:F});if(!M)return;if((null==a||null==(i=a.value)?void 0:i.kind)!==R.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==a||null==(l=a.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});F||t.setHeader("x-nextjs-cache",N?"REVALIDATED":a.isMiss?"MISS":a.isStale?"STALE":"HIT"),y&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let n=(0,m.fromNodeOutgoingHttpHeaders)(a.value.headers);F&&M||n.delete(g.NEXT_CACHE_TAGS_HEADER),!a.cacheControl||t.getHeader("Cache-Control")||n.get("Cache-Control")||n.set("Cache-Control",(0,h.getCacheControlHeader)(a.cacheControl)),await (0,p.sendResponse)(z,X,new Response(a.value.body,{headers:n,status:a.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await v.onRequestError(e,t,{routerKind:"App Router",routePath:P,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:N})},!1,O),M)throw t;await (0,p.sendResponse)(z,X,new Response(null,{status:500}));return}finally{(()=>{if(!a)return;let e=t.statusCode;a.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(a.setStatus({code:n.SpanStatusCode.ERROR}),a.setAttribute("error.type",e.toString()));let o=U.getRootSpanAttributes();if(!o)return;if(o.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${o.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=o.get("next.route")||P,i=`${G} ${r}`;a.setAttributes({"next.route":r,"http.route":r,"next.span_name":i}),a.updateName(i),s&&s!==a&&(s.setAttribute("http.route",r),s.updateName(i))})()}};if(q&&K)await Z(K,void 0);else{let t=U.getActiveScopeSpan();await U.withPropagatedContext(e.headers,()=>U.trace(d.BaseServerSpan.handleRequest,{spanName:`${G} ${$}`,kind:n.SpanKind.SERVER,attributes:{"http.method":G,"http.target":e.url}},e=>Z(e,t)),void 0,!q)}}e.s(["handler",0,_,"patchFetch",0,function(){return(0,r.patchFetch)({workAsyncStorage:$,workUnitAsyncStorage:E})},"routeModule",0,v,"serverHooks",0,C,"workAsyncStorage",0,$,"workUnitAsyncStorage",0,E])}];

//# sourceMappingURL=_04yt_n_._.js.map