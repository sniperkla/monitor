module.exports=[64842,e=>e.a(async(t,n)=>{try{var r=e.i(89171),o=e.i(47185),a=e.i(51631),i=e.i(37034),l=t([o]);async function s(e){try{let{searchParams:t}=new URL(e.url),n=t.get("connectionId");if(!n)return r.NextResponse.json({success:!1,error:"connectionId is required"},{status:400});let a=e.headers.get("x-ssh-mode"),l=e.headers.get("x-preferred-relay"),s=await (0,o.getSshConfig)(n,{sshMode:a,preferredRelay:l}),c=`
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"
RCLONE_CMD=""
for _p in "$HOME/.local/bin/rclone" "/usr/bin/rclone" "/usr/local/bin/rclone" "/snap/bin/rclone"; do
  if [ -x "$_p" ]; then RCLONE_CMD="$_p"; break; fi
done
if [ -z "$RCLONE_CMD" ]; then
  RCLONE_CMD="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || true)"
fi
if [ -z "$RCLONE_CMD" ] || [ ! -x "$RCLONE_CMD" ]; then
  echo "NOT_INSTALLED"
  exit 0
fi

VERSION="$($RCLONE_CMD version 2>/dev/null | head -n 2)"
CONFIG_PATH="$($RCLONE_CMD config file 2>/dev/null | grep -i ".conf" | tail -n 1)"
if [ -z "$CONFIG_PATH" ]; then
  if [ -f "$HOME/.config/rclone/rclone.conf" ]; then CONFIG_PATH="$HOME/.config/rclone/rclone.conf"
  elif [ -f "/root/.config/rclone/rclone.conf" ]; then CONFIG_PATH="/root/.config/rclone/rclone.conf"
  elif [ -f "/etc/rclone/rclone.conf" ]; then CONFIG_PATH="/etc/rclone/rclone.conf"
  fi
fi

REMOTES="$($RCLONE_CMD listremotes 2>/dev/null)"
if [ -z "$REMOTES" ] && [ "$(id -u)" != "0" ] && sudo -n true 2>/dev/null; then
  REMOTES="$(sudo $RCLONE_CMD listremotes 2>/dev/null || true)"
fi

if [ -z "$REMOTES" ]; then
  REMOTES="$(grep -h -E '^\\[.+\\]' "$HOME/.config/rclone/rclone.conf" "/root/.config/rclone/rclone.conf" "/etc/rclone/rclone.conf" 2>/dev/null | tr -d '[]:' || true)"
fi

MEM_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048')"
NPROC="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo '2')"

echo "===VERSION==="
echo "$VERSION"
echo "===CONFIG_PATH==="
echo "$CONFIG_PATH"
echo "===REMOTES==="
echo "$REMOTES"
echo "===MEM_MB==="
echo "$MEM_MB"
echo "===NPROC==="
echo "$NPROC"
`,u=(await (0,o.execCommand)(s,c)).stdout||"";if(u.includes("NOT_INSTALLED"))return r.NextResponse.json({success:!0,installed:!1,version:null,remotes:[],configPath:null});let d=u.match(/===VERSION===\n([\s\S]*?)(?====CONFIG_PATH===|$)/),p=u.match(/===CONFIG_PATH===\n([\s\S]*?)(?====REMOTES===|$)/),h=u.match(/===REMOTES===\n([\s\S]*?)(?====MEM_MB===|$)/),f=u.match(/===MEM_MB===\n(\d+)/),R=u.match(/===NPROC===\n(\d+)/),m=d?d[1].trim():"rclone installed",E=p?p[1].trim():null,v=h?h[1].trim():"",C=f?parseInt(f[1],10):2048,g=R?parseInt(R[1],10):2,O="standard",M=2,_=4,$="16M",N="32M";C<=2048?(O="low_ram",M=1,_=2,$="16M",N="32M"):C>=8192&&(O="high_spec",M=4,_=8,$="64M",N="64M");let S={totalMemMb:C,cpuCores:g,mode:O,recommended:{transfers:M,checkers:_,bufferSize:$,chunkSize:N}},T=Array.from(new Set(v.split("\n").map(e=>e.trim().replace(/:$/,"").replace(/^\[/,"").replace(/\]$/,"")).filter(Boolean))),w="";if(E){let e=(0,i.shellQuote)(E);w=(await (0,o.execCommand)(s,`cat ${e} 2>/dev/null || sudo cat ${e} 2>/dev/null || true`)).stdout||""}w||(w=(await (0,o.execCommand)(s,"rclone config show 2>/dev/null || true")).stdout||"");let P={},x=null;w.split("\n").forEach(e=>{let t=e.trim();if(t.startsWith("[")&&t.endsWith("]"))P[x=t.slice(1,-1)]={};else if(x&&t.includes("=")){let e=t.indexOf("="),n=t.slice(0,e).trim(),r=t.slice(e+1).trim();P[x][n]=r}});let A=`
PS_CMD="ps -eo pid,user,%cpu,%mem,etime,args 2>/dev/null || ps aux 2>/dev/null"
RAW_PS="$($PS_CMD | grep -i rclone | grep -v grep || true)"
if [ "$(id -u)" != "0" ] && sudo -n true 2>/dev/null; then
  ROOT_PS="$(sudo $PS_CMD | grep -i rclone | grep -v grep || true)"
  if [ -n "$ROOT_PS" ]; then
    RAW_PS="$RAW_PS
$ROOT_PS"
  fi
fi
echo "$RAW_PS"
`,b=await (0,o.execCommand)(s,A),y=new Set,H=(b.stdout||"").split("\n").map(e=>e.trim()).filter(Boolean).map(e=>{let t=e.split(/\s+/);if(t.length<6)return null;let n=t[0];if(y.has(n))return null;y.add(n);let r=t[1],o=t[2],a=t[3],i=t[4],l=t.slice(5).join(" "),s=l.includes("cron")||l.includes("/etc/cron")||l.includes("anacron");return{pid:n,user:r,cpu:o,mem:a,etime:i,cmd:l,isCron:s}}).filter(Boolean),I=`
if command -v crontab >/dev/null 2>&1; then
  crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' || true
fi
if [ "$(id -u)" != "0" ] && sudo -n true 2>/dev/null; then
  sudo crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' | sed 's/^/[root] /' || true
fi
`,D=((await (0,o.execCommand)(s,I)).stdout||"").split("\n").map(e=>e.trim()).filter(Boolean);return r.NextResponse.json({success:!0,installed:!0,version:m,remotes:T,remoteDetails:P,configPath:E,configContent:w,runningJobs:H,cronJobs:D,serverSpecs:S})}catch(e){return a.logger.error("[rclone/status] error:",e.message),r.NextResponse.json({success:!1,error:e.message},{status:500})}}[o]=l.then?(await l)():l,e.s(["GET",0,s]),n()}catch(e){n(e)}},!1),60563,e=>{"use strict";var t=e.i(8970),n=e.i(74017),r=e.i(96250),o=e.i(59756),a=e.i(61916),i=e.i(74677),l=e.i(69741),s=e.i(16795),c=e.i(87718),u=e.i(95169),d=e.i(47587),p=e.i(66012),h=e.i(70101),f=e.i(26937),R=e.i(10372),m=e.i(93695);e.i(52474);var E=e.i(5232);let v=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/rclone/status/route",pathname:"/api/rclone/status",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/rclone/status/route.js",nextConfigOutput:"",userland:()=>e.r(64842),...{}}),{workAsyncStorage:C,workUnitAsyncStorage:g,serverHooks:O}=v;async function M(e,t,r){r.requestMeta&&(0,o.setRequestMeta)(e,r.requestMeta),v.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let C="/api/rclone/status/route";C=C.replace(/\/index$/,"")||"/";let g=await v.prepare(e,t,{srcPage:C,multiZoneDraftMode:!1});if(!g)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:O,deploymentId:M,params:_,nextConfig:$,parsedUrl:N,isDraftMode:S,prerenderManifest:T,routerServerContext:w,isOnDemandRevalidate:P,revalidateOnlyGenerated:x,resolvedPathname:A,clientReferenceManifest:b,serverActionsManifest:y}=g,H=(0,l.normalizeAppPath)(C),I=!!(T.dynamicRoutes[H]||T.routes[A]),D=async()=>((null==w?void 0:w.render404)?await w.render404(e,t,N,!1):t.end("This page could not be found"),null);if(I&&!S){let e=!!T.routes[A],t=T.dynamicRoutes[H];if(t&&!1===t.fallback&&!e){if($.adapterPath)return await D();throw new m.NoFallbackError}}let L=null;!I||v.isDev||S||(L="/index"===(L=A)?"/":L);let q=!0===v.isDev||!I,k=I&&!q;y&&b&&(0,i.setManifestsSingleton)({page:C,clientReferenceManifest:b,serverActionsManifest:y});let F=e.method||"GET",U=(0,a.getTracer)(),B=U.getActiveScopeSpan(),G=!!(null==w?void 0:w.isWrappedByNextServer),j=!!(0,o.getRequestMeta)(e,"minimalMode"),z=(0,o.getRequestMeta)(e,"incrementalCache")||await v.getIncrementalCache(e,$,T,j);null==z||z.resetRequestCache(),globalThis.__incrementalCache=z;let K={params:_,previewProps:T.preview,renderOpts:{experimental:{authInterrupts:!!$.experimental.authInterrupts,useCacheTimeout:$.experimental.useCacheTimeout},cacheComponents:!!$.cacheComponents,validationLevel:$.experimental.instantInsights.validationLevel,supportsDynamicResponse:q,incrementalCache:z,hmrRefreshHash:(0,o.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:$.cacheLife,staticPageGenerationTimeout:$.staticPageGenerationTimeout,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,r,o)=>v.onRequestError(e,t,r,o,w)},sharedContext:{buildId:O,deploymentId:M}},W=new s.NodeNextRequest(e),V=new s.NodeNextResponse(t),X=c.NextRequestAdapter.fromNodeNextRequest(W,(0,c.signalFromNodeResponse)(t)),Q=async({previousCacheEntry:n})=>{try{if(!j&&P&&x&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await v.handle(X,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let a=K.renderOpts.pendingWaitUntil;a&&r.waitUntil&&(r.waitUntil(a),a=void 0);let i=K.renderOpts.collectedTags;if(!I)return await (0,p.sendResponse)(W,V,o,a),null;{let e=await o.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(o.headers);i&&(t[R.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=R.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,r=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=R.INFINITE_CACHE?!1!==n&&n>0?$.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:E.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:r}}}}catch(t){throw(null==n?void 0:n.isStale)&&await v.onRequestError(e,t,{routerKind:"App Router",routePath:C,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:k,isOnDemandRevalidate:P})},!1,w),t}},Z=async(o,i)=>{try{var l,s;let o=await v.handleResponse({req:e,nextConfig:$,cacheKey:L,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:T,isRoutePPREnabled:!1,isOnDemandRevalidate:P,revalidateOnlyGenerated:x,responseGenerator:Q,waitUntil:r.waitUntil,isMinimalMode:j});if(!I)return;if((null==o||null==(l=o.value)?void 0:l.kind)!==E.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==o||null==(s=o.value)?void 0:s.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});j||t.setHeader("x-nextjs-cache",P?"REVALIDATED":o.isMiss?"MISS":o.isStale?"STALE":"HIT"),S&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let a=(0,h.fromNodeOutgoingHttpHeaders)(o.value.headers);j&&I||a.delete(R.NEXT_CACHE_TAGS_HEADER),!o.cacheControl||t.getHeader("Cache-Control")||a.get("Cache-Control")||a.set("Cache-Control",(0,f.getCacheControlHeader)(o.cacheControl)),await (0,p.sendResponse)(W,V,new Response(o.value.body,{headers:a,status:o.value.status||200}));return}catch(t){if(t instanceof m.NoFallbackError||await v.onRequestError(e,t,{routerKind:"App Router",routePath:H,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:k,isOnDemandRevalidate:P})},!1,w),I)throw t;await (0,p.sendResponse)(W,V,new Response(null,{status:500}));return}finally{(()=>{if(!o)return;let e=t.statusCode;o.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(o.setStatus({code:a.SpanStatusCode.ERROR}),o.setAttribute("error.type",e.toString()));let n=U.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==u.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=n.get("next.route")||H,l=`${F} ${r}`;o.setAttributes({"next.route":r,"http.route":r,"next.span_name":l}),o.updateName(l),i&&i!==o&&(i.setAttribute("http.route",r),i.updateName(l))})()}};if(G&&B)await Z(B,void 0);else{let t=U.getActiveScopeSpan();await U.withPropagatedContext(e.headers,()=>U.trace(u.BaseServerSpan.handleRequest,{spanName:`${F} ${C}`,kind:a.SpanKind.SERVER,attributes:{"http.method":F,"http.target":e.url}},e=>Z(e,t)),void 0,!G)}}e.s(["handler",0,M,"patchFetch",0,function(){return(0,r.patchFetch)({workAsyncStorage:C,workUnitAsyncStorage:g})},"routeModule",0,v,"serverHooks",0,O,"workAsyncStorage",0,C,"workUnitAsyncStorage",0,g])}];

//# sourceMappingURL=_0k7ovj5._.js.map