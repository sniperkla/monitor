module.exports=[54579,e=>e.a(async(t,r)=>{try{var s=e.i(89171),n=e.i(61095),o=e.i(23667),i=e.i(80533),a=e.i(47185),l=e.i(79834),u=e.i(37034),c=t([i,a]);[i,a]=c.then?(await c)():c;let R="$HOME/.monitor-firewall-source-update.sh",f="$HOME/.monitor-firewall-source-update.log",$="$HOME/.monitor-firewall-source-update.lock",v="# monitor-firewall-source-update";async function d(e,t){return(0,a.getSshConfig)(t,{sshMode:e.headers.get("x-ssh-mode"),preferredRelay:e.headers.get("x-preferred-relay")})}async function p(e){try{if(!await (0,o.getServerSession)(i.authOptions))return s.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let t=new URL(e.url).searchParams.get("connectionId");if(!t)return s.NextResponse.json({success:!1,error:"connectionId is required"},{status:400});let r=(await (0,a.execCommand)(await d(e,t),String.raw`
CRON_LINE="$(crontab -l 2>/dev/null | grep -F ${(0,u.shellQuote)(v)} | tail -n 1 || true)"
if [ -n "$CRON_LINE" ]; then
  echo "installed=true"
  echo "schedule=$(printf '%s\\n' "$CRON_LINE" | awk '{print $1 " " $2 " " $3 " " $4 " " $5}')"
else
  echo "installed=false"
fi
if [ -d ${$} ]; then echo "running=true"; else echo "running=false"; fi
tail -n 160 ${f} 2>/dev/null || true
`,{pool:!1})).stdout||"",n=r.split(/\r?\n/).filter(e=>!/^(installed|running)=(true|false)$/.test(e)&&!/^schedule=.+$/.test(e)).join("\n"),l=r.match(/^schedule=(.+)$/m)?.[1]?.trim()||null;return s.NextResponse.json({success:!0,installed:/^installed=true$/m.test(r),running:/^running=true$/m.test(r),schedule:l,log:n})}catch(e){return s.NextResponse.json({success:!1,error:e.message||"Could not read source update status"},{status:500})}}async function h(e){try{let t,r,c,p;if(!await (0,o.getServerSession)(i.authOptions))return s.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let{connectionId:h,sourceUrl:m,protectedIps:w=[],manualBlocks:E=[],schedule:C,runNow:b=!1,confirmation:x}=await e.json();if(!h)return s.NextResponse.json({success:!1,error:"connectionId is required"},{status:400});if(t=String(x||"").trim().toLowerCase(),!("confirm"===t||"apply"===t||"yes"===t||"ok"===t||t.startsWith("confirm")))return s.NextResponse.json({success:!1,error:"Type confirm to allow automatic firewall updates."},{status:400});let g=function(e){let t;try{t=new URL(e)}catch{throw Error("Enter a valid HTTPS blocklist URL.")}if("https:"!==t.protocol||t.username||t.password)throw Error("Only public HTTPS blocklist URLs are allowed.");return t.toString()}(m),_=function(e){let t=String(e||"").trim().replace(/\s+/g," "),r=t.split(" ");if(5!==r.length||r.some(e=>!/^[0-9*/,\-]+$/.test(e)))throw Error("Enter a valid five-part cron schedule, for example */30 * * * *.");if(r.some(e=>e.includes("/0")))throw Error("Cron intervals must be greater than zero.");return t}(C||"*/30 * * * *"),S=w.map(l.normalizeEntry).filter(Boolean);if(S.some(e=>e.includes("/")))return s.NextResponse.json({success:!1,error:"Automated updates currently require individual protected IP addresses, not CIDR ranges."},{status:400});let I=(0,l.sanitizeManualEntries)(E);if(I.length!==E.length)return s.NextResponse.json({success:!1,error:"Manual blocks contain invalid or non-IPv4 entries."},{status:400});let O=[...new Set([...(0,l.remoteClientIps)(e.headers),...S])].filter(e=>4===(0,n.isIP)(e)),T=await d(e,h),N=Buffer.from((r=O.map(u.shellQuote).join(" "),c=(0,l.buildAllowlistRestoreFragment)(O),p=(0,l.buildRestoreServiceExec)(c),String.raw`#!/bin/bash
set -u
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SOURCE_URL=${(0,u.shellQuote)(g)}
PROTECTED_IPS=(${r})
LOCK_DIR=${$}
if ! mkdir "$LOCK_DIR" 2>/dev/null; then echo "[$(date -Is)] Another blocklist update is already running."; exit 0; fi
trap 'rm -rf "$LOCK_DIR" "$WORK_DIR"' EXIT
WORK_DIR="$(mktemp -d /tmp/monitor-firewall-source.XXXXXX)" || exit 1
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "[$(date -Is)] ERROR: root or passwordless sudo is required."; exit 41; fi; }
echo "[$(date -Is)] Starting scheduled source update: $SOURCE_URL"
command -v curl >/dev/null 2>&1 || { echo "[$(date -Is)] ERROR: curl is required."; exit 42; }
command -v ipset >/dev/null 2>&1 || { echo "[$(date -Is)] ERROR: ipset is required."; exit 43; }
command -v iptables >/dev/null 2>&1 || { echo "[$(date -Is)] ERROR: iptables is required."; exit 44; }
echo "[$(date -Is)] Downloading source…"
curl --fail --location --proto '=https' --connect-timeout 20 --max-time 180 --retry 2 --silent --show-error "$SOURCE_URL" -o "$WORK_DIR/source.txt"
echo "[$(date -Is)] Parsing IPv4 entries…"
awk '{ sub(/#.*/, ""); if ($1 ~ /^[0-9][0-9.]*([/][0-9][0-9]?)?$/) print $1 }' "$WORK_DIR/source.txt" | LC_ALL=C sort -u > "$WORK_DIR/entries.txt"
COUNT="$(wc -l < "$WORK_DIR/entries.txt" | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then echo "[$(date -Is)] ERROR: source contained no IPv4 entries."; exit 45; fi
if [ "$COUNT" -gt ${l.MAX_BLOCKLIST_ENTRIES} ]; then echo "[$(date -Is)] ERROR: source has $COUNT entries; safety limit is ${l.MAX_BLOCKLIST_ENTRIES}."; exit 46; fi
echo "[$(date -Is)] Validated $COUNT unique IPv4 entries. Building replacement set…"
run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${l.MAX_BLOCKLIST_ENTRIES} -exist
run ipset create monitor_blocklist_next hash:net family inet hashsize 4096 maxelem ${l.MAX_BLOCKLIST_ENTRIES} -exist
run ipset flush monitor_blocklist_next
awk '{ print "add monitor_blocklist_next " $1 " -exist" }' "$WORK_DIR/entries.txt" > "$WORK_DIR/ipset.restore"
run sh -c 'ipset restore -exist < "$1"' sh "$WORK_DIR/ipset.restore"
for protected_ip in "\${PROTECTED_IPS[@]}"; do
  if run ipset test monitor_blocklist_next "$protected_ip" >/dev/null 2>&1; then
    echo "[$(date -Is)] REFUSED: downloaded list contains protected IP $protected_ip. Existing blocklist remains active."
    exit 51
  fi
done
echo "[$(date -Is)] Protection check passed. Swapping IPSet atomically…"
run ipset swap monitor_blocklist_next monitor_blocklist
run ipset destroy monitor_blocklist_next || true
# Ensure the manual quick-block set and its composite wiring exist — the swap
# above only replaced the feed set, so quick blocks are preserved as-is.
${(0,l.buildManualSetCommands)()}

# 1-3. Protect Host ports, Docker published ports, and routed traffic via the
# composite set (unions feed + manual quick blocks).
${(0,l.buildDropRuleCommands)()}

# 4. Admin allowlist — always takes precedence over the blocklist.
#    Includes the server's own egress IP plus the baked-in protected IPs.
run ipset create monitor_allowlist hash:ip family inet -exist
run ipset flush monitor_allowlist
OWN_EGRESS="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
if [ -n "$OWN_EGRESS" ]; then run ipset add monitor_allowlist "$OWN_EGRESS" -exist; fi
for wl_ip in "\${PROTECTED_IPS[@]}"; do [ -n "$wl_ip" ] && run ipset add monitor_allowlist "$wl_ip" -exist; done
run iptables -C INPUT -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I INPUT 1 -m set --match-set monitor_allowlist src -j ACCEPT
if run iptables -L DOCKER-USER >/dev/null 2>&1; then
  run iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT
fi
run iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT

run install -d -m 700 /var/lib/monitor-firewall
${(0,l.buildSnapshotSaveCommands)()}
run sh -c 'ipset save monitor_allowlist > /var/lib/monitor-firewall/monitor_allowlist.ipset'
if command -v systemctl >/dev/null 2>&1; then
  run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "${p}"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT'
  run systemctl daemon-reload || true
  run systemctl enable monitor-blocklist-restore.service || true
fi
echo "[$(date -Is)] SUCCESS: $COUNT entries are active across Host & Docker ports."
`),"utf8").toString("base64"),P=await (0,a.execCommand)(T,String.raw`
set -eu
printf '%s' ${(0,u.shellQuote)(N)} | base64 -d > ${R}
chmod 700 ${R}
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${(0,u.shellQuote)(v)} > "$TMP_CRON" || true
echo ${(0,u.shellQuote)(`${_} /bin/bash ${R} >> ${f} 2>&1 ${v}`)} >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
${b?`nohup /bin/bash ${R} >> ${f} 2>&1 < /dev/null &`:"true"}
`,{pool:!1});if(0!==P.code)return s.NextResponse.json({success:!1,error:P.stderr?.trim()||"Could not install the automated source update."},{status:500});let y=await (0,a.execCommand)(T,String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 && run ipset list monitor_blocklist >/dev/null 2>&1 || exit 0
${(0,l.buildManualSetCommands)(I)}
${(0,l.buildDropRuleCommands)()}
run install -d -m 700 /var/lib/monitor-firewall
${(0,l.buildSnapshotSaveCommands)()}
echo SEEDED
`,{pool:!1});if(0!==y.code)return s.NextResponse.json({success:!1,error:y.stderr?.trim()||"Could not seed manual blocks on this server."},{status:500});return s.NextResponse.json({success:!0,schedule:_,message:b?"Automated source update installed and started. Open the activity view below to follow it.":`Automated source update installed for ${_}.`})}catch(e){return s.NextResponse.json({success:!1,error:e.message||"Could not configure the source update"},{status:500})}}async function m(e){try{if(!await (0,o.getServerSession)(i.authOptions))return s.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let{connectionId:t}=await e.json();if(!t)return s.NextResponse.json({success:!1,error:"connectionId is required"},{status:400});let r=await (0,a.execCommand)(await d(e,t),String.raw`
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${(0,u.shellQuote)(v)} > "$TMP_CRON" || true
crontab "$TMP_CRON"
rm -f "$TMP_CRON" ${R} ${f}
`,{pool:!1});if(0!==r.code)return s.NextResponse.json({success:!1,error:r.stderr?.trim()||"Could not remove the daily source update."},{status:500});return s.NextResponse.json({success:!0,message:"Automated source update and its log were removed."})}catch(e){return s.NextResponse.json({success:!1,error:e.message||"Could not remove the source update"},{status:500})}}e.s(["DELETE",0,m,"GET",0,p,"POST",0,h]),r()}catch(e){r(e)}},!1),35403,e=>{"use strict";var t=e.i(8970),r=e.i(74017),s=e.i(96250),n=e.i(59756),o=e.i(61916),i=e.i(74677),a=e.i(69741),l=e.i(16795),u=e.i(87718),c=e.i(95169),d=e.i(47587),p=e.i(66012),h=e.i(70101),m=e.i(26937),R=e.i(10372),f=e.i(93695);e.i(52474);var $=e.i(5232);let v=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/firewall/source/route",pathname:"/api/firewall/source",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/firewall/source/route.js",nextConfigOutput:"",userland:()=>e.r(54579),...{}}),{workAsyncStorage:w,workUnitAsyncStorage:E,serverHooks:C}=v;async function b(e,t,s){s.requestMeta&&(0,n.setRequestMeta)(e,s.requestMeta),v.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let w="/api/firewall/source/route";w=w.replace(/\/index$/,"")||"/";let E=await v.prepare(e,t,{srcPage:w,multiZoneDraftMode:!1});if(!E)return t.statusCode=400,t.end("Bad Request"),null==s.waitUntil||s.waitUntil.call(s,Promise.resolve()),null;let{buildId:C,deploymentId:b,params:x,nextConfig:g,parsedUrl:_,isDraftMode:S,prerenderManifest:I,routerServerContext:O,isOnDemandRevalidate:T,revalidateOnlyGenerated:N,resolvedPathname:P,clientReferenceManifest:y,serverActionsManifest:A}=E,k=(0,a.normalizeAppPath)(w),D=!!(I.dynamicRoutes[k]||I.routes[P]),U=async()=>((null==O?void 0:O.render404)?await O.render404(e,t,_,!1):t.end("This page could not be found"),null);if(D&&!S){let e=!!I.routes[P],t=I.dynamicRoutes[k];if(t&&!1===t.fallback&&!e){if(g.adapterPath)return await U();throw new f.NoFallbackError}}let M=null;!D||v.isDev||S||(M="/index"===(M=P)?"/":M);let j=!0===v.isDev||!D,L=D&&!j;A&&y&&(0,i.setManifestsSingleton)({page:w,clientReferenceManifest:y,serverActionsManifest:A});let q=e.method||"GET",H=(0,o.getTracer)(),K=H.getActiveScopeSpan(),W=!!(null==O?void 0:O.isWrappedByNextServer),F=!!(0,n.getRequestMeta)(e,"minimalMode"),B=(0,n.getRequestMeta)(e,"incrementalCache")||await v.getIncrementalCache(e,g,I,F);null==B||B.resetRequestCache(),globalThis.__incrementalCache=B;let X={params:x,previewProps:I.preview,renderOpts:{experimental:{authInterrupts:!!g.experimental.authInterrupts,useCacheTimeout:g.experimental.useCacheTimeout},cacheComponents:!!g.cacheComponents,validationLevel:g.experimental.instantInsights.validationLevel,supportsDynamicResponse:j,incrementalCache:B,hmrRefreshHash:(0,n.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:g.cacheLife,staticPageGenerationTimeout:g.staticPageGenerationTimeout,waitUntil:s.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,s,n)=>v.onRequestError(e,t,s,n,O)},sharedContext:{buildId:C,deploymentId:b}},G=new l.NodeNextRequest(e),z=new l.NodeNextResponse(t),Q=u.NextRequestAdapter.fromNodeNextRequest(G,(0,u.signalFromNodeResponse)(t)),V=async({previousCacheEntry:r})=>{try{if(!F&&T&&N&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await v.handle(Q,X);e.fetchMetrics=X.renderOpts.fetchMetrics;let o=X.renderOpts.pendingWaitUntil;o&&s.waitUntil&&(s.waitUntil(o),o=void 0);let i=X.renderOpts.collectedTags;if(!D)return await (0,p.sendResponse)(G,z,n,o),null;{let e=await n.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(n.headers);i&&(t[R.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==X.renderOpts.collectedRevalidate&&!(X.renderOpts.collectedRevalidate>=R.INFINITE_CACHE)&&X.renderOpts.collectedRevalidate,s=void 0===X.renderOpts.collectedExpire||X.renderOpts.collectedExpire>=R.INFINITE_CACHE?!1!==r&&r>0?g.expireTime:void 0:X.renderOpts.collectedExpire;return{value:{kind:$.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:s}}}}catch(t){throw(null==r?void 0:r.isStale)&&await v.onRequestError(e,t,{routerKind:"App Router",routePath:w,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:T})},!1,O),t}},Z=async(n,i)=>{try{var a,l;let n=await v.handleResponse({req:e,nextConfig:g,cacheKey:M,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:I,isRoutePPREnabled:!1,isOnDemandRevalidate:T,revalidateOnlyGenerated:N,responseGenerator:V,waitUntil:s.waitUntil,isMinimalMode:F});if(!D)return;if((null==n||null==(a=n.value)?void 0:a.kind)!==$.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==n||null==(l=n.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});F||t.setHeader("x-nextjs-cache",T?"REVALIDATED":n.isMiss?"MISS":n.isStale?"STALE":"HIT"),S&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let o=(0,h.fromNodeOutgoingHttpHeaders)(n.value.headers);F&&D||o.delete(R.NEXT_CACHE_TAGS_HEADER),!n.cacheControl||t.getHeader("Cache-Control")||o.get("Cache-Control")||o.set("Cache-Control",(0,m.getCacheControlHeader)(n.cacheControl)),await (0,p.sendResponse)(G,z,new Response(n.value.body,{headers:o,status:n.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await v.onRequestError(e,t,{routerKind:"App Router",routePath:k,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:T})},!1,O),D)throw t;await (0,p.sendResponse)(G,z,new Response(null,{status:500}));return}finally{(()=>{if(!n)return;let e=t.statusCode;n.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(n.setStatus({code:o.SpanStatusCode.ERROR}),n.setAttribute("error.type",e.toString()));let r=H.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==c.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let s=r.get("next.route")||k,a=`${q} ${s}`;n.setAttributes({"next.route":s,"http.route":s,"next.span_name":a}),n.updateName(a),i&&i!==n&&(i.setAttribute("http.route",s),i.updateName(a))})()}};if(W&&K)await Z(K,void 0);else{let t=H.getActiveScopeSpan();await H.withPropagatedContext(e.headers,()=>H.trace(c.BaseServerSpan.handleRequest,{spanName:`${q} ${w}`,kind:o.SpanKind.SERVER,attributes:{"http.method":q,"http.target":e.url}},e=>Z(e,t)),void 0,!W)}}e.s(["handler",0,b,"patchFetch",0,function(){return(0,s.patchFetch)({workAsyncStorage:w,workUnitAsyncStorage:E})},"routeModule",0,v,"serverHooks",0,C,"workAsyncStorage",0,w,"workUnitAsyncStorage",0,E])}];

//# sourceMappingURL=_1wi70q_._.js.map