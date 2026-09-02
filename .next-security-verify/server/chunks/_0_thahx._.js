module.exports=[55211,e=>e.a(async(t,n)=>{try{var a=e.i(89171),r=e.i(23667),s=e.i(80533),o=e.i(47185),i=e.i(51631),l=t([s,o]);[s,o]=l.then?(await l)():l;let u=`
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

echo "===CPU_INFO==="
CPU_MODEL="$(grep -m1 '^model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || \\
             sysctl -n machdep.cpu.brand_string 2>/dev/null || \\
             lscpu 2>/dev/null | grep '^Model name' | cut -d: -f2 | xargs || \\
             echo 'Unknown')"
CPU_CORES="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || \\
             sysctl -n hw.ncpu 2>/dev/null || \\
             nproc 2>/dev/null || echo '1')"
echo "MODEL=$CPU_MODEL"
echo "CORES=$CPU_CORES"

echo "===CPU_STAT==="
# Instant raw counters from /proc/stat or fallback
if [ -f /proc/stat ]; then
  grep '^cpu ' /proc/stat 2>/dev/null
else
  # macOS / BSD fallback: idle percentage
  CPU_IDLE="$(top -l 1 -n 0 2>/dev/null | grep -o '[0-9]*\\.[0-9]* id' | head -1 | awk '{print $1}' || echo '0')"
  echo "MACOS_IDLE=$CPU_IDLE"
fi

echo "===LOAD_AVG==="
cat /proc/loadavg 2>/dev/null || \\
  sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' || \\
  uptime | grep -oP 'load average[s]?: \\K[0-9., ]+'

echo "===MEMORY==="
if [ -f /proc/meminfo ]; then
  awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/MemFree/{f=$2}/^Buffers/{b=$2}/^Cached/{c=$2} \\
    END{
      used=t-a;
      printf "TOTAL=%d\\nUSED=%d\\nFREE=%d\\nAVAIL=%d\\n",t*1024,used*1024,f*1024,a*1024
    }' /proc/meminfo
else
  # macOS / BSD
  TOTAL="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  PAGESIZE="$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)"
  PAGES_WIRED="$(vm_stat 2>/dev/null | awk '/wired/{print $4+0}')"
  PAGES_ACTIVE="$(vm_stat 2>/dev/null | awk '/Pages active/{print $3+0}')"
  PAGES_COMPRESSED="$(vm_stat 2>/dev/null | awk '/occupied by compressor/{print $5+0}')"
  awk -v total="$TOTAL" -v ps="$PAGESIZE" -v pw="$PAGES_WIRED" -v pa="$PAGES_ACTIVE" -v pc="$PAGES_COMPRESSED" \\
    'BEGIN{
       used=(pw+pa+pc)*ps;
       printf "TOTAL=%d\\nUSED=%d\\nFREE=%d\\nAVAIL=%d\\n",total,used,total-used,total-used
     }' /dev/null
fi

echo "===DISK==="
df -Pk 2>/dev/null | awk 'NR>1 && $1!~/tmpfs|devtmpfs|udev|overlay|shm|cgroupfs/ && $6~/^\\// {
  gsub(/%/,"",$5);
  used_bytes=$3*1024; total_bytes=$2*1024; free_bytes=$4*1024;
  printf "%s|%d|%d|%d|%s\\n",$6,total_bytes,used_bytes,free_bytes,$5
}' | sort -t'|' -k1

echo "===NETWORK==="
if [ -f /proc/net/dev ]; then
  cat /proc/net/dev
else
  echo "UNAVAILABLE"
fi

echo "===SYSTEM==="
HOSTNAME="$(hostname 2>/dev/null || echo 'unknown')"
KERNEL="$(uname -r 2>/dev/null || echo 'unknown')"
ARCH="$(uname -m 2>/dev/null || echo 'unknown')"
UPTIME_SEC="$(cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || sysctl -n kern.boottime 2>/dev/null | awk -F'[= ,]' '{print int($8)}' || echo '0')"
OS_NAME="$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s 2>/dev/null || echo 'unknown')"
echo "HOSTNAME=$HOSTNAME"
echo "KERNEL=$KERNEL"
echo "ARCH=$ARCH"
echo "UPTIME=$UPTIME_SEC"
echo "OS=$OS_NAME"
`;async function c(e){try{if(!await (0,r.getServerSession)(s.authOptions))return a.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let{searchParams:t}=new URL(e.url),n=t.get("connectionId");if(!n)return a.NextResponse.json({success:!1,error:"Missing connectionId"},{status:400});let i=await (0,o.getSshConfig)(n),l=await (0,o.execCommand)(i,u);if(0!==l.code&&!l.stdout)return a.NextResponse.json({success:!1,error:l.stderr||"Failed to collect metrics"},{status:500});let c=l.stdout||"",d=c.match(/===CPU_INFO===\n([\s\S]*?)(?====CPU_STAT===)/)?.[1]||"",p=d.match(/^MODEL=(.*)$/m)?.[1]?.trim()||"Unknown",m=parseInt(d.match(/^CORES=(\d+)$/m)?.[1]||"1",10),h=c.match(/===CPU_STAT===\n([\s\S]*?)(?====LOAD_AVG===)/)?.[1]||"",E=null,v=0,R=h.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);if(R){let e=parseInt(R[1],10)||0,t=parseInt(R[2],10)||0,n=parseInt(R[3],10)||0,a=parseInt(R[4],10)||0,r=parseInt(R[5],10)||0,s=parseInt(R[6],10)||0,o=parseInt(R[7],10)||0,i=parseInt(R[8],10)||0,l=e+t+n+a+r+s+o+i;E={user:e,nice:t,system:n,idle:a,iowait:r,irq:s,softirq:o,steal:i,total:l}}else{let e=parseFloat(h.match(/^MACOS_IDLE=([\d.]+)/m)?.[1]||"100");v=Math.max(0,Math.min(100,100-e))}let f=(c.match(/===LOAD_AVG===\n([\s\S]*?)(?====MEMORY===)/)?.[1]?.trim()||"").split(/[\s,]+/).filter(Boolean),S={"1m":parseFloat(f[0])||0,"5m":parseFloat(f[1])||0,"15m":parseFloat(f[2])||0};!E&&0===v&&S["1m"]>0&&(v=Math.min(100,S["1m"]/Math.max(1,m)*100));let A=c.match(/===MEMORY===\n([\s\S]*?)(?====DISK===)/)?.[1]||"",g=parseInt(A.match(/^TOTAL=(\d+)$/m)?.[1]||"0",10),w=parseInt(A.match(/^USED=(\d+)$/m)?.[1]||"0",10),T=parseInt(A.match(/^FREE=(\d+)$/m)?.[1]||"0",10),C=parseInt(A.match(/^AVAIL=(\d+)$/m)?.[1]||String(T),10),$=g>0?parseFloat((w/g*100).toFixed(1)):0,I=(c.match(/===DISK===\n([\s\S]*?)(?====NETWORK===)/)?.[1]||"").split("\n").filter(e=>e.includes("|")).map(e=>{let[t,n,a,r,s]=e.split("|");return{mount:t?.trim(),total:parseInt(n,10)||0,used:parseInt(a,10)||0,free:parseInt(r,10)||0,usedPercent:parseFloat(s)||0}}).filter(e=>e.mount),O=c.match(/===NETWORK===\n([\s\S]*?)(?====SYSTEM===)/)?.[1]||"",P=[],_=0,x=0;O.includes("UNAVAILABLE")||(_=(P=function(e){let t=[];for(let n of e.split("\n").slice(2)){let e=n.trim();if(!e)continue;let a=e.indexOf(":");if(a<0)continue;let r=e.slice(0,a).trim();if("lo"===r)continue;let s=e.slice(a+1).trim().split(/\s+/);if(s.length<9)continue;let o=parseInt(s[0],10)||0,i=parseInt(s[8],10)||0;t.push({name:r,rxBytesTotal:o,txBytesTotal:i})}return t}(O)).reduce((e,t)=>e+t.rxBytesTotal,0),x=P.reduce((e,t)=>e+t.txBytesTotal,0));let y=c.match(/===SYSTEM===\n([\s\S]*)$/)?.[1]||"",M=y.match(/^HOSTNAME=(.*)$/m)?.[1]?.trim()||"unknown",N=y.match(/^KERNEL=(.*)$/m)?.[1]?.trim()||"unknown",b=y.match(/^ARCH=(.*)$/m)?.[1]?.trim()||"unknown",k=parseInt(y.match(/^UPTIME=(\d+)$/m)?.[1]||"0",10),D=y.match(/^OS=(.*)$/m)?.[1]?.trim()||"unknown";return a.NextResponse.json({success:!0,timestamp:new Date().toISOString(),timestampMs:Date.now(),cpu:{model:p,cores:m,usage:v,loadAverage:[S["1m"],S["5m"],S["15m"]],raw:E},memory:{total:g,used:w,free:T,available:C,usedPercent:$},disk:{filesystems:I},network:{interfaces:P,rxTotal:_,txTotal:x,rxRate:0,txRate:0},system:{hostname:M,os:D,kernel:N,arch:b,uptime:k}})}catch(e){return i.logger.error("[server-monitor/metrics] error:",e.message),a.NextResponse.json({success:!1,error:e.message},{status:500})}}e.s(["GET",0,c]),n()}catch(e){n(e)}},!1),9981,e=>{"use strict";var t=e.i(8970),n=e.i(74017),a=e.i(96250),r=e.i(59756),s=e.i(61916),o=e.i(74677),i=e.i(69741),l=e.i(16795),c=e.i(87718),u=e.i(95169),d=e.i(47587),p=e.i(66012),m=e.i(70101),h=e.i(26937),E=e.i(10372),v=e.i(93695);e.i(52474);var R=e.i(5232);let f=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/server-monitor/metrics/route",pathname:"/api/server-monitor/metrics",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/server-monitor/metrics/route.js",nextConfigOutput:"",userland:()=>e.r(55211),...{}}),{workAsyncStorage:S,workUnitAsyncStorage:A,serverHooks:g}=f;async function w(e,t,a){a.requestMeta&&(0,r.setRequestMeta)(e,a.requestMeta),f.isDev&&(0,r.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let S="/api/server-monitor/metrics/route";S=S.replace(/\/index$/,"")||"/";let A=await f.prepare(e,t,{srcPage:S,multiZoneDraftMode:!1});if(!A)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:g,deploymentId:w,params:T,nextConfig:C,parsedUrl:$,isDraftMode:I,prerenderManifest:O,routerServerContext:P,isOnDemandRevalidate:_,revalidateOnlyGenerated:x,resolvedPathname:y,clientReferenceManifest:M,serverActionsManifest:N}=A,b=(0,i.normalizeAppPath)(S),k=!!(O.dynamicRoutes[b]||O.routes[y]),D=async()=>((null==P?void 0:P.render404)?await P.render404(e,t,$,!1):t.end("This page could not be found"),null);if(k&&!I){let e=!!O.routes[y],t=O.dynamicRoutes[b];if(t&&!1===t.fallback&&!e){if(C.adapterPath)return await D();throw new v.NoFallbackError}}let U=null;!k||f.isDev||I||(U="/index"===(U=y)?"/":U);let L=!0===f.isDev||!k,H=k&&!L;N&&M&&(0,o.setManifestsSingleton)({page:S,clientReferenceManifest:M,serverActionsManifest:N});let F=e.method||"GET",q=(0,s.getTracer)(),K=q.getActiveScopeSpan(),G=!!(null==P?void 0:P.isWrappedByNextServer),B=!!(0,r.getRequestMeta)(e,"minimalMode"),j=(0,r.getRequestMeta)(e,"incrementalCache")||await f.getIncrementalCache(e,C,O,B);null==j||j.resetRequestCache(),globalThis.__incrementalCache=j;let V={params:T,previewProps:O.preview,renderOpts:{experimental:{authInterrupts:!!C.experimental.authInterrupts,useCacheTimeout:C.experimental.useCacheTimeout},cacheComponents:!!C.cacheComponents,validationLevel:C.experimental.instantInsights.validationLevel,supportsDynamicResponse:L,incrementalCache:j,hmrRefreshHash:(0,r.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:C.cacheLife,staticPageGenerationTimeout:C.staticPageGenerationTimeout,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,a,r)=>f.onRequestError(e,t,a,r,P)},sharedContext:{buildId:g,deploymentId:w}},W=new l.NodeNextRequest(e),Y=new l.NodeNextResponse(t),z=c.NextRequestAdapter.fromNodeNextRequest(W,(0,c.signalFromNodeResponse)(t)),X=async({previousCacheEntry:n})=>{try{if(!B&&_&&x&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await f.handle(z,V);e.fetchMetrics=V.renderOpts.fetchMetrics;let s=V.renderOpts.pendingWaitUntil;s&&a.waitUntil&&(a.waitUntil(s),s=void 0);let o=V.renderOpts.collectedTags;if(!k)return await (0,p.sendResponse)(W,Y,r,s),null;{let e=await r.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(r.headers);o&&(t[E.NEXT_CACHE_TAGS_HEADER]=o),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==V.renderOpts.collectedRevalidate&&!(V.renderOpts.collectedRevalidate>=E.INFINITE_CACHE)&&V.renderOpts.collectedRevalidate,a=void 0===V.renderOpts.collectedExpire||V.renderOpts.collectedExpire>=E.INFINITE_CACHE?!1!==n&&n>0?C.expireTime:void 0:V.renderOpts.collectedExpire;return{value:{kind:R.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:a}}}}catch(t){throw(null==n?void 0:n.isStale)&&await f.onRequestError(e,t,{routerKind:"App Router",routePath:S,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:H,isOnDemandRevalidate:_})},!1,P),t}},Z=async(r,o)=>{try{var i,l;let r=await f.handleResponse({req:e,nextConfig:C,cacheKey:U,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:O,isRoutePPREnabled:!1,isOnDemandRevalidate:_,revalidateOnlyGenerated:x,responseGenerator:X,waitUntil:a.waitUntil,isMinimalMode:B});if(!k)return;if((null==r||null==(i=r.value)?void 0:i.kind)!==R.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==r||null==(l=r.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});B||t.setHeader("x-nextjs-cache",_?"REVALIDATED":r.isMiss?"MISS":r.isStale?"STALE":"HIT"),I&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let s=(0,m.fromNodeOutgoingHttpHeaders)(r.value.headers);B&&k||s.delete(E.NEXT_CACHE_TAGS_HEADER),!r.cacheControl||t.getHeader("Cache-Control")||s.get("Cache-Control")||s.set("Cache-Control",(0,h.getCacheControlHeader)(r.cacheControl)),await (0,p.sendResponse)(W,Y,new Response(r.value.body,{headers:s,status:r.value.status||200}));return}catch(t){if(t instanceof v.NoFallbackError||await f.onRequestError(e,t,{routerKind:"App Router",routePath:b,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:H,isOnDemandRevalidate:_})},!1,P),k)throw t;await (0,p.sendResponse)(W,Y,new Response(null,{status:500}));return}finally{(()=>{if(!r)return;let e=t.statusCode;r.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(r.setStatus({code:s.SpanStatusCode.ERROR}),r.setAttribute("error.type",e.toString()));let n=q.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==u.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=n.get("next.route")||b,i=`${F} ${a}`;r.setAttributes({"next.route":a,"http.route":a,"next.span_name":i}),r.updateName(i),o&&o!==r&&(o.setAttribute("http.route",a),o.updateName(i))})()}};if(G&&K)await Z(K,void 0);else{let t=q.getActiveScopeSpan();await q.withPropagatedContext(e.headers,()=>q.trace(u.BaseServerSpan.handleRequest,{spanName:`${F} ${S}`,kind:s.SpanKind.SERVER,attributes:{"http.method":F,"http.target":e.url}},e=>Z(e,t)),void 0,!G)}}e.s(["handler",0,w,"patchFetch",0,function(){return(0,a.patchFetch)({workAsyncStorage:S,workUnitAsyncStorage:A})},"routeModule",0,f,"serverHooks",0,g,"workAsyncStorage",0,S,"workUnitAsyncStorage",0,A])}];

//# sourceMappingURL=_0_thahx._.js.map