module.exports=[37091,e=>{"use strict";var t=e.i(79834);e.s(["buildIpSetApplyScript",0,function(e,r=[],s=[]){let o=(0,t.sanitizeManualEntries)(s),i=(0,t.buildAllowlistCommands)(r),n=(0,t.buildRestoreServiceExec)((0,t.buildAllowlistRestoreFragment)()),a=(0,t.buildLastResortCommands)();return String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
command -v iptables >/dev/null 2>&1 || { echo "IPTABLES_UNAVAILABLE" >&2; exit 43; }
test -r "${e}" || { echo "IMPORT_FILE_MISSING" >&2; exit 44; }
SORTED_FILE="${e}.sorted"
trap 'rm -f "${e}" "$SORTED_FILE" "$SORTED_FILE.restore"' EXIT
echo "MONITOR_PROGRESS|22|Validating and deduplicating the blocklist"
LC_ALL=C sort -u "${e}" > "$SORTED_FILE"
echo "MONITOR_PROGRESS|38|Creating the isolated replacement IPSet"
run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${t.MAX_BLOCKLIST_ENTRIES} -exist
run ipset create monitor_blocklist_next hash:net family inet hashsize 4096 maxelem ${t.MAX_BLOCKLIST_ENTRIES} -exist
run ipset flush monitor_blocklist_next
echo "MONITOR_PROGRESS|54|Loading entries into the replacement set"
# Bulk load via a single ipset restore — a per-entry add loop forks sudo
# once per line and effectively hangs on multi-million-entry lists.
awk '{ print "add monitor_blocklist_next " $1 " -exist" }' "$SORTED_FILE" > "$SORTED_FILE.restore"
run sh -c 'ipset restore -exist < "$1"' sh "$SORTED_FILE.restore"
echo "MONITOR_PROGRESS|70|Atomically switching the active protection"
run ipset swap monitor_blocklist_next monitor_blocklist
run ipset destroy monitor_blocklist_next || true
# Re-seed the manual quick-block set from the dashboard (never flushed here)
${(0,t.buildManualSetCommands)(o)}

# 1-3. Protect Host ports, Docker published ports, and routed traffic — all
# via the composite set so manual quick blocks stay enforced.
${(0,t.buildDropRuleCommands)()}

# 4. Admin allowlist — always takes precedence over the blocklist
${i}

echo "MONITOR_PROGRESS|82|Saving the reboot recovery configuration"
run install -d -m 700 /var/lib/monitor-firewall
${(0,t.buildSnapshotSaveCommands)()}
${"run sh -c 'ipset save monitor_allowlist > /var/lib/monitor-firewall/monitor_allowlist.ipset'"}

if command -v systemctl >/dev/null 2>&1; then
  # --- Service 1: Restore blocklist on every boot ---
  run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist on boot
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "${n}"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT'

  # --- Service 2: Auto-reinject into DOCKER-USER whenever Docker daemon restarts ---
  # Writes the hook script that listens to docker daemon events
  if command -v docker >/dev/null 2>&1; then
    run sh -c 'cat > /usr/local/bin/monitor-docker-firewall-hook.sh <<"HOOKSCRIPT"
#!/bin/bash
# Automatically reinjected by monitor-firewall when Docker daemon restarts.
# Listens for Docker daemon start events and reinstalls the DOCKER-USER rule.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SNAPSHOT="/var/lib/monitor-firewall/monitor_blocklist.ipset"

reinject() {
  sleep 2  # Give Docker time to recreate the DOCKER-USER chain
  if iptables -L DOCKER-USER >/dev/null 2>&1 && [ -f "$SNAPSHOT" ]; then
    ipset restore -exist < "$SNAPSHOT" 2>/dev/null || true
    ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${t.MAX_BLOCKLIST_ENTRIES} -exist 2>/dev/null || true
    ipset create ${t.MANUAL_SET} hash:net family inet hashsize 1024 maxelem 500 -exist 2>/dev/null || true
    ipset create ${t.COMPOSITE_SET} list:set -exist 2>/dev/null || true
    ipset add ${t.COMPOSITE_SET} monitor_blocklist -exist 2>/dev/null || true
    ipset add ${t.COMPOSITE_SET} ${t.MANUAL_SET} -exist 2>/dev/null || true
    iptables -C DOCKER-USER -m set --match-set ${t.COMPOSITE_SET} src -j DROP 2>/dev/null || \
    iptables -I DOCKER-USER 1 -m set --match-set ${t.COMPOSITE_SET} src -j DROP
    iptables -C FORWARD -m set --match-set ${t.COMPOSITE_SET} src -j DROP 2>/dev/null || \
    iptables -I FORWARD 1 -m set --match-set ${t.COMPOSITE_SET} src -j DROP
    while iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D DOCKER-USER -m set --match-set monitor_blocklist src -j DROP; done
    while iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D FORWARD -m set --match-set monitor_blocklist src -j DROP; done
    if ipset list monitor_allowlist >/dev/null 2>&1; then
      iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || \
      iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT
      iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || \
      iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT
    fi
    echo "[$(date -Is)] monitor-docker-firewall-hook: DOCKER-USER rule reinjected successfully."
  fi
}

# Listen for Docker daemon-level start events (fires when dockerd itself restarts)
docker events --filter type=daemon --filter event=start --format "{{.Action}}" | while read -r event; do
  echo "[$(date -Is)] monitor-docker-firewall-hook: Docker daemon started, reinjecting firewall rule..."
  reinject
done
HOOKSCRIPT'
    run chmod 750 /usr/local/bin/monitor-docker-firewall-hook.sh

    run sh -c 'cat > /etc/systemd/system/monitor-docker-firewall-hook.service <<"UNIT"
[Unit]
Description=Monitor Firewall - Auto-reinject DOCKER-USER rule on Docker restart
Documentation=https://github.com/your-repo/monitor
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=5
ExecStart=/bin/bash /usr/local/bin/monitor-docker-firewall-hook.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT'

    run systemctl enable monitor-docker-firewall-hook.service || true
    run systemctl restart monitor-docker-firewall-hook.service 2>/dev/null || run systemctl start monitor-docker-firewall-hook.service || true
  fi

  run systemctl daemon-reload || true
  run systemctl enable monitor-blocklist-restore.service || true
fi
${a}
echo "MONITOR_PROGRESS|96|Verifying the firewall configuration"
echo "APPLIED=$(wc -l < "$SORTED_FILE" | tr -d ' ')"
`}])},30023,e=>e.a(async(t,r)=>{try{var s=e.i(89171),o=e.i(23667),i=e.i(80533),n=e.i(47185),a=e.i(25273),l=e.i(37091),c=e.i(79834),u=t([i,n]);async function d(e){try{let t;if(!await (0,o.getServerSession)(i.authOptions))return s.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let{connectionId:r,batchId:u,confirmation:d,manualBlocks:p=[]}=await e.json();if(!r||!u)return s.NextResponse.json({success:!1,error:"connectionId and batchId are required."},{status:400});if(t=String(d||"").trim().toLowerCase(),!("confirm"===t||"apply"===t||"yes"===t||"ok"===t||t.startsWith("confirm")))return s.NextResponse.json({success:!1,error:"Type confirm to confirm this firewall change."},{status:400});let h=(0,a.getBulkBatch)(u);if(h.conflicts.length)return s.NextResponse.json({success:!1,error:"Blocked to prevent self-lockout.",conflicts:h.conflicts},{status:409});let m=(0,c.sanitizeManualEntries)(p);if(m.length!==p.length)return s.NextResponse.json({success:!1,error:"Manual blocks contain invalid or non-IPv4 entries."},{status:400});let R=[...new Set([...(0,c.remoteClientIps)(e.headers),...h.protectedIps||[]])],f=R.length?(0,c.getConflictingEntries)(m,R):[];if(f.length)return s.NextResponse.json({success:!1,error:"Blocked to prevent self-lockout.",conflicts:f},{status:409});let E=`/tmp/monitor-firewall-${u}.txt`,v=async t=>{let s;t?.({type:"progress",progress:5,message:"Connecting securely to the server"});let o=await (0,n.getSshConfig)(r,{sshMode:e.headers.get("x-ssh-mode"),preferredRelay:e.headers.get("x-preferred-relay")});t?.({type:"progress",progress:12,message:"Uploading the validated blocklist"});let i=-1;await (0,n.sftpUpload)(o,h.filePath,E,{onProgress:(e,r)=>{if(!t||!r)return;let s=Math.round(e/r*100);s!==i&&(i=s,t({type:"progress",progress:12+Math.round(.12*s),message:`Uploading the validated blocklist (${s}%)`}))}}),t?.({type:"progress",progress:24,message:"Upload complete — starting safe replacement"});let c=await (0,n.execCommand)(o,(0,l.buildIpSetApplyScript)(E,h.protectedIps||[],m),{pool:!1,onStdout:t?(s="",e=>{let r=(s+=e).split(/\r?\n/);s=r.pop()||"",r.forEach(e=>{let r=e.match(/^MONITOR_PROGRESS\|(\d+)\|(.+)$/);r&&t({type:"progress",progress:Number(r[1]),message:r[2]})})}):void 0});if(0!==c.code)throw Error(c.stderr?.trim()||"Firewall update failed before it could be applied.");return await (0,a.discardBulkBatch)(u),{success:!0,entries:h.entryCount,message:"Batch blocklist applied and configured to restore after reboot."}};if(e.headers.get("accept")?.includes("application/x-ndjson")){let e,t;return e=new TextEncoder,t=new ReadableStream({start(t){let r=r=>t.enqueue(e.encode(`${JSON.stringify(r)}
`));Promise.resolve(v(r)).then(e=>r({type:"complete",progress:100,...e})).catch(e=>r({type:"error",error:e.message||"Could not apply blocklist batch"})).finally(()=>t.close())}}),new s.NextResponse(t,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"}})}let S=await v();return s.NextResponse.json(S)}catch(e){return s.NextResponse.json({success:!1,error:e.message||"Could not apply blocklist batch"},{status:500})}}[i,n]=u.then?(await u)():u,e.s(["POST",0,d]),r()}catch(e){r(e)}},!1),99638,e=>{"use strict";var t=e.i(8970),r=e.i(74017),s=e.i(96250),o=e.i(59756),i=e.i(61916),n=e.i(74677),a=e.i(69741),l=e.i(16795),c=e.i(87718),u=e.i(95169),d=e.i(47587),p=e.i(66012),h=e.i(70101),m=e.i(26937),R=e.i(10372),f=e.i(93695);e.i(52474);var E=e.i(5232);let v=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/firewall/bulk/apply/route",pathname:"/api/firewall/bulk/apply",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/firewall/bulk/apply/route.js",nextConfigOutput:"",userland:()=>e.r(30023),...{}}),{workAsyncStorage:S,workUnitAsyncStorage:b,serverHooks:g}=v;async function O(e,t,s){s.requestMeta&&(0,o.setRequestMeta)(e,s.requestMeta),v.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let S="/api/firewall/bulk/apply/route";S=S.replace(/\/index$/,"")||"/";let b=await v.prepare(e,t,{srcPage:S,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==s.waitUntil||s.waitUntil.call(s,Promise.resolve()),null;let{buildId:g,deploymentId:O,params:w,nextConfig:C,parsedUrl:k,isDraftMode:y,prerenderManifest:T,routerServerContext:_,isOnDemandRevalidate:I,revalidateOnlyGenerated:x,resolvedPathname:A,clientReferenceManifest:P,serverActionsManifest:D}=b,N=(0,a.normalizeAppPath)(S),$=!!(T.dynamicRoutes[N]||T.routes[A]),M=async()=>((null==_?void 0:_.render404)?await _.render404(e,t,k,!1):t.end("This page could not be found"),null);if($&&!y){let e=!!T.routes[A],t=T.dynamicRoutes[N];if(t&&!1===t.fallback&&!e){if(C.adapterPath)return await M();throw new f.NoFallbackError}}let U=null;!$||v.isDev||y||(U="/index"===(U=A)?"/":U);let j=!0===v.isDev||!$,L=$&&!j;D&&P&&(0,n.setManifestsSingleton)({page:S,clientReferenceManifest:P,serverActionsManifest:D});let H=e.method||"GET",F=(0,i.getTracer)(),K=F.getActiveScopeSpan(),q=!!(null==_?void 0:_.isWrappedByNextServer),B=!!(0,o.getRequestMeta)(e,"minimalMode"),G=(0,o.getRequestMeta)(e,"incrementalCache")||await v.getIncrementalCache(e,C,T,B);null==G||G.resetRequestCache(),globalThis.__incrementalCache=G;let W={params:w,previewProps:T.preview,renderOpts:{experimental:{authInterrupts:!!C.experimental.authInterrupts,useCacheTimeout:C.experimental.useCacheTimeout},cacheComponents:!!C.cacheComponents,validationLevel:C.experimental.instantInsights.validationLevel,supportsDynamicResponse:j,incrementalCache:G,hmrRefreshHash:(0,o.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:C.cacheLife,staticPageGenerationTimeout:C.staticPageGenerationTimeout,waitUntil:s.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,s,o)=>v.onRequestError(e,t,s,o,_)},sharedContext:{buildId:g,deploymentId:O}},z=new l.NodeNextRequest(e),V=new l.NodeNextResponse(t),X=c.NextRequestAdapter.fromNodeNextRequest(z,(0,c.signalFromNodeResponse)(t)),J=async({previousCacheEntry:r})=>{try{if(!B&&I&&x&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await v.handle(X,W);e.fetchMetrics=W.renderOpts.fetchMetrics;let i=W.renderOpts.pendingWaitUntil;i&&s.waitUntil&&(s.waitUntil(i),i=void 0);let n=W.renderOpts.collectedTags;if(!$)return await (0,p.sendResponse)(z,V,o,i),null;{let e=await o.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(o.headers);n&&(t[R.NEXT_CACHE_TAGS_HEADER]=n),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==W.renderOpts.collectedRevalidate&&!(W.renderOpts.collectedRevalidate>=R.INFINITE_CACHE)&&W.renderOpts.collectedRevalidate,s=void 0===W.renderOpts.collectedExpire||W.renderOpts.collectedExpire>=R.INFINITE_CACHE?!1!==r&&r>0?C.expireTime:void 0:W.renderOpts.collectedExpire;return{value:{kind:E.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:s}}}}catch(t){throw(null==r?void 0:r.isStale)&&await v.onRequestError(e,t,{routerKind:"App Router",routePath:S,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:I})},!1,_),t}},Z=async(o,n)=>{try{var a,l;let o=await v.handleResponse({req:e,nextConfig:C,cacheKey:U,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:T,isRoutePPREnabled:!1,isOnDemandRevalidate:I,revalidateOnlyGenerated:x,responseGenerator:J,waitUntil:s.waitUntil,isMinimalMode:B});if(!$)return;if((null==o||null==(a=o.value)?void 0:a.kind)!==E.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==o||null==(l=o.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});B||t.setHeader("x-nextjs-cache",I?"REVALIDATED":o.isMiss?"MISS":o.isStale?"STALE":"HIT"),y&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let i=(0,h.fromNodeOutgoingHttpHeaders)(o.value.headers);B&&$||i.delete(R.NEXT_CACHE_TAGS_HEADER),!o.cacheControl||t.getHeader("Cache-Control")||i.get("Cache-Control")||i.set("Cache-Control",(0,m.getCacheControlHeader)(o.cacheControl)),await (0,p.sendResponse)(z,V,new Response(o.value.body,{headers:i,status:o.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await v.onRequestError(e,t,{routerKind:"App Router",routePath:N,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:I})},!1,_),$)throw t;await (0,p.sendResponse)(z,V,new Response(null,{status:500}));return}finally{(()=>{if(!o)return;let e=t.statusCode;o.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(o.setStatus({code:i.SpanStatusCode.ERROR}),o.setAttribute("error.type",e.toString()));let r=F.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==u.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let s=r.get("next.route")||N,a=`${H} ${s}`;o.setAttributes({"next.route":s,"http.route":s,"next.span_name":a}),o.updateName(a),n&&n!==o&&(n.setAttribute("http.route",s),n.updateName(a))})()}};if(q&&K)await Z(K,void 0);else{let t=F.getActiveScopeSpan();await F.withPropagatedContext(e.headers,()=>F.trace(u.BaseServerSpan.handleRequest,{spanName:`${H} ${S}`,kind:i.SpanKind.SERVER,attributes:{"http.method":H,"http.target":e.url}},e=>Z(e,t)),void 0,!q)}}e.s(["handler",0,O,"patchFetch",0,function(){return(0,s.patchFetch)({workAsyncStorage:S,workUnitAsyncStorage:b})},"routeModule",0,v,"serverHooks",0,g,"workAsyncStorage",0,S,"workUnitAsyncStorage",0,b])}];

//# sourceMappingURL=_0bw34g7._.js.map