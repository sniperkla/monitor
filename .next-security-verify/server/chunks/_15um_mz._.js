module.exports=[74688,e=>e.a(async(t,n)=>{try{var s=e.i(89171),a=e.i(23667),r=e.i(80533),i=e.i(47185),o=e.i(51631),l=e.i(77667),d=e.i(46589),u=e.i(89460),c=e.i(24827),p=t([r,i,d]);[r,i,d]=p.then?(await p)():p;let v={start:"Started",stop:"Stopped",restart:"Restarted",enable:"Enabled",disable:"Disabled",update:"Updated",uninstall:"Uninstalled","install-version":"Installed"};async function m(e,{appName:t,action:n,version:s,host:a,success:r,error:i}){try{let i=await (0,d.default)();await (0,u.getAuditLogModel)(i).create(e);let o=v[n]||n,l=r?`${o} ${t}${s?` ${s}`:""} on ${a}`:`Failed to ${n} ${t} on ${a}`;await (0,c.getActivityLogModel)(i).create({userId:e.userId,username:e.username,category:"server",action:`service.${n}`,message:l,target:a,status:r?"success":"error",meta:{exitCode:e.exitCode},ip:e.ip})}catch(e){o.logger.warn("[server-monitor/app-action] audit log failed:",e.message)}}let f=new Set(["start","stop","restart","enable","disable","update","uninstall","install-version"]),g={docker:"docker",nginx:"nginx",mongodb:"mongod","mysql / mariadb":"mysql",mysql:"mysql",mariadb:"mariadb",postgresql:"postgresql",redis:"redis-server"};async function h(e){try{let t,n,d=await (0,a.getServerSession)(r.authOptions);if(!d)return s.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});try{t=await e.json()}catch(e){return s.NextResponse.json({success:!1,error:"Invalid JSON body"},{status:400})}let{connectionId:u,appName:c,action:p}=t,h="string"==typeof t.version?t.version.trim():"";if(!u||!c||!p)return s.NextResponse.json({success:!1,error:"Missing required fields: connectionId, appName, action"},{status:400});let v=["start","stop","restart","status","enable","disable","update","uninstall","check-update","list-versions","install-version"];if(!v.includes(p))return s.NextResponse.json({success:!1,error:`Invalid action. Must be one of: ${v.join(", ")}`},{status:400});if(f.has(p)){let e=`app-action:${d.user?.id||d.user?.sub||"anon"}:${u}`,t=(0,l.checkRateLimit)(e,20);if(!t.allowed)return s.NextResponse.json({success:!1,error:`Too many requests. Retry in ${Math.ceil(t.resetIn/1e3)}s`},{status:429,headers:{"Retry-After":String(Math.ceil(t.resetIn/1e3))}})}if("install-version"===p){if(!h)return s.NextResponse.json({success:!1,error:"Missing required field: version"},{status:400});if(!/^[A-Za-z0-9][A-Za-z0-9._~:+-]*$/.test(h))return s.NextResponse.json({success:!1,error:`Invalid version format: ${h}`},{status:400})}let y=d.user?.id||d.user?.sub||null;try{n=await (0,i.getSshConfig)(u,{userId:y})}catch(e){if(/Access denied/.test(e.message))return o.logger.warn(`[server-monitor/app-action] DENIED ${p} on ${u} by user ${y}`),s.NextResponse.json({success:!1,error:"Access denied: this connection belongs to another user"},{status:403});throw e}let $=function(e,t,n){let s,a=(s=g[String(e||"").toLowerCase()]||String(e||"").toLowerCase(),/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(s)?s:null);if(!a)throw Error(`Invalid app name: ${e}`);let r=`sudo systemctl ${t} ${a} 2>&1 || systemctl ${t} ${a} 2>&1`,i=`sudo service ${a} ${t} 2>&1 || service ${a} ${t} 2>&1`;switch(t){case"start":case"stop":case"restart":return`
        if command -v systemctl >/dev/null 2>&1; then
          ${r}
        else
          ${i}
        fi
      `;case"status":return`
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl status ${a} 2>&1 || systemctl status ${a} 2>&1
        else
          sudo service ${a} status 2>&1 || service ${a} status 2>&1
        fi
      `;case"enable":return`
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl enable ${a} 2>&1 || systemctl enable ${a} 2>&1
        else
          echo "Enable action not supported without systemd"
          exit 1
        fi
      `;case"disable":return`
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl disable ${a} 2>&1 || systemctl disable ${a} 2>&1
        else
          echo "Disable action not supported without systemd"
          exit 1
        fi
      `;case"check-update":return`
        PKG="${a}"
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -qq >/dev/null 2>&1 || true
          if apt-get -s install --only-upgrade "$PKG" 2>/dev/null | grep -q '^Inst '; then
            echo "UPDATE_AVAILABLE"
          else
            echo "UP_TO_DATE"
          fi
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf -q check-update "$PKG" >/dev/null 2>&1
          RC=$?
          if [ $RC -eq 100 ]; then echo "UPDATE_AVAILABLE"
          elif [ $RC -eq 0 ]; then echo "UP_TO_DATE"
          else echo "UNKNOWN"
          fi
        elif command -v yum >/dev/null 2>&1; then
          sudo yum -q check-update "$PKG" >/dev/null 2>&1
          RC=$?
          if [ $RC -eq 100 ]; then echo "UPDATE_AVAILABLE"
          elif [ $RC -eq 0 ]; then echo "UP_TO_DATE"
          else echo "UNKNOWN"
          fi
        elif command -v pacman >/dev/null 2>&1; then
          if pacman -Qu "$PKG" >/dev/null 2>&1; then echo "UPDATE_AVAILABLE"; else echo "UP_TO_DATE"; fi
        elif command -v brew >/dev/null 2>&1; then
          if brew outdated --quiet "$PKG" 2>/dev/null | grep -q .; then echo "UPDATE_AVAILABLE"; else echo "UP_TO_DATE"; fi
        else
          echo "UNKNOWN"
        fi
      `;case"update":return`
        OUT=""
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -qq >/dev/null 2>&1 || true
          OUT=$(sudo DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade ${a} -y 2>&1)
        elif command -v dnf >/dev/null 2>&1; then
          OUT=$(sudo dnf -q -y update ${a} 2>&1)
        elif command -v yum >/dev/null 2>&1; then
          OUT=$(sudo yum -q -y update ${a} 2>&1)
        elif command -v pacman >/dev/null 2>&1; then
          OUT=$(sudo pacman -Syu ${a} --noconfirm --quiet 2>&1)
        elif command -v brew >/dev/null 2>&1; then
          OUT=$(brew upgrade ${a} 2>&1)
        else
          echo "No supported package manager found"
          exit 1
        fi
        echo "$OUT"
        # "Already latest version" outcomes are successes, not failures
        if echo "$OUT" | grep -qiE "already the newest version|0 upgraded|Nothing to do|[Nn]o packages marked|does not have any installation candidate|[Nn]o match for argument"; then
          exit 0
        fi
      `;case"list-versions":return`
        PKG="${a}"
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -qq >/dev/null 2>&1 || true
          apt-cache madison "$PKG" 2>/dev/null | awk '{print $3}' | awk '!seen[$0]++' | head -40
        elif command -v dnf >/dev/null 2>&1; then
          dnf --showduplicates list "$PKG" 2>/dev/null | grep "^${a}\\." | awk '{print $2}' | awk '!seen[$0]++' | tail -40
        elif command -v yum >/dev/null 2>&1; then
          yum --showduplicates list "$PKG" 2>/dev/null | grep "^${a}\\." | awk '{print $2}' | awk '!seen[$0]++' | tail -40
        elif command -v apk >/dev/null 2>&1; then
          apk search -v "$PKG" 2>/dev/null | sed "s/^${a}-//" | awk '!seen[$0]++' | head -40
        elif command -v brew >/dev/null 2>&1; then
          brew info --json=v2 "$PKG" 2>/dev/null | tr ',' '\\n' | grep '"version"' | head -5 || echo "__UNSUPPORTED__"
        else
          echo "__UNSUPPORTED__"
        fi
      `;case"install-version":return`
        PKG="${a}"
        VER="${n}"
        if command -v apt-get >/dev/null 2>&1; then
          sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$PKG=$VER" 2>&1
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y --allowerasing "$PKG-$VER" 2>&1 || sudo dnf downgrade -y "$PKG-$VER" 2>&1
        elif command -v yum >/dev/null 2>&1; then
          sudo yum install -y "$PKG-$VER" 2>&1 || sudo yum downgrade -y "$PKG-$VER" 2>&1
        elif command -v apk >/dev/null 2>&1; then
          sudo apk add "$PKG=$VER" 2>&1
        else
          echo "Exact version pinning is not supported by this system's package manager"
          exit 1
        fi
      `;case"uninstall":return`
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get remove ${a} -y 2>&1
        elif command -v yum >/dev/null 2>&1; then
          sudo yum remove ${a} -y 2>&1
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf remove ${a} -y 2>&1
        elif command -v pacman >/dev/null 2>&1; then
          sudo pacman -R ${a} --noconfirm 2>&1
        elif command -v brew >/dev/null 2>&1; then
          brew uninstall ${a} 2>&1
        else
          echo "No supported package manager found"
          exit 1
        fi
      `;default:throw Error(`Unknown action: ${t}`)}}(c,p,h);o.logger.info(`[server-monitor/app-action] Executing ${p} for ${c}`);let R=["update","install-version","uninstall"].includes(p)?3e5:6e4,A=(e.headers.get("x-forwarded-for")||"").split(",")[0].trim()||null,w=await (0,i.execCommand)(n,$,{timeoutMs:R});o.logger.info("[server-monitor/app-action] Result:",{code:w.code,stdoutLength:w.stdout?.length||0,stderrLength:w.stderr?.length||0});let E=((w.stdout||"")+(w.stderr||"")).slice(0,65536),x=0===w.code||E.includes("Started")||E.includes("Stopped")||E.includes("active (running)")||E.includes("success"),N={success:x,action:p,appName:c,output:E.trim(),exitCode:w.code};if("check-update"===p){let e=E.trim().split("\n").map(e=>e.trim()).find(e=>["UPDATE_AVAILABLE","UP_TO_DATE","UNKNOWN"].includes(e))||"UNKNOWN";N.success=!0,N.updateAvailable="UPDATE_AVAILABLE"===e,N.verdict=e}if("list-versions"===p){let e=E.trim().split("\n").map(e=>e.trim()).filter(Boolean);e.includes("__UNSUPPORTED__")?(N.success=!1,N.error="Version listing is not supported by this system's package manager",N.versions=[]):(N.success=!0,N.versions=[...new Set(e)].slice(0,40))}return"install-version"===p&&(N.version=h),x||(N.error=E.trim().split("\n").find(e=>e.trim())||`Command exited with code ${w.code}`),f.has(p)&&m({userId:y,username:d.user?.name||d.user?.email||null,connectionId:u,host:n.host,appName:c,action:p,version:h||null,success:x,exitCode:w.code??null,error:N.error?String(N.error).slice(0,500):null,ip:A},{appName:c,action:p,version:h,host:n.host,success:x,error:N.error}),s.NextResponse.json(N)}catch(n){o.logger.error("[server-monitor/app-action] error:",n.message);let e=n.message||"",t=/^Invalid app name:/.test(e)?400:/Command timed out/.test(e)?504:500;return s.NextResponse.json({success:!1,error:500===t?"Failed to execute action on remote server":e},{status:t})}}e.s(["POST",0,h]),n()}catch(e){n(e)}},!1),37199,e=>{"use strict";var t=e.i(8970),n=e.i(74017),s=e.i(96250),a=e.i(59756),r=e.i(61916),i=e.i(74677),o=e.i(69741),l=e.i(16795),d=e.i(87718),u=e.i(95169),c=e.i(47587),p=e.i(66012),m=e.i(70101),h=e.i(26937),v=e.i(10372),f=e.i(93695);e.i(52474);var g=e.i(5232);let y=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/server-monitor/app-action/route",pathname:"/api/server-monitor/app-action",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/server-monitor/app-action/route.js",nextConfigOutput:"",userland:()=>e.r(74688),...{}}),{workAsyncStorage:$,workUnitAsyncStorage:R,serverHooks:A}=y;async function w(e,t,s){s.requestMeta&&(0,a.setRequestMeta)(e,s.requestMeta),y.isDev&&(0,a.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let $="/api/server-monitor/app-action/route";$=$.replace(/\/index$/,"")||"/";let R=await y.prepare(e,t,{srcPage:$,multiZoneDraftMode:!1});if(!R)return t.statusCode=400,t.end("Bad Request"),null==s.waitUntil||s.waitUntil.call(s,Promise.resolve()),null;let{buildId:A,deploymentId:w,params:E,nextConfig:x,parsedUrl:N,isDraftMode:P,prerenderManifest:T,routerServerContext:b,isOnDemandRevalidate:_,revalidateOnlyGenerated:C,resolvedPathname:S,clientReferenceManifest:U,serverActionsManifest:q}=R,O=(0,o.normalizeAppPath)($),I=!!(T.dynamicRoutes[O]||T.routes[S]),k=async()=>((null==b?void 0:b.render404)?await b.render404(e,t,N,!1):t.end("This page could not be found"),null);if(I&&!P){let e=!!T.routes[S],t=T.dynamicRoutes[O];if(t&&!1===t.fallback&&!e){if(x.adapterPath)return await k();throw new f.NoFallbackError}}let D=null;!I||y.isDev||P||(D="/index"===(D=S)?"/":D);let K=!0===y.isDev||!I,L=I&&!K;q&&U&&(0,i.setManifestsSingleton)({page:$,clientReferenceManifest:U,serverActionsManifest:q});let G=e.method||"GET",M=(0,r.getTracer)(),j=M.getActiveScopeSpan(),H=!!(null==b?void 0:b.isWrappedByNextServer),V=!!(0,a.getRequestMeta)(e,"minimalMode"),B=(0,a.getRequestMeta)(e,"incrementalCache")||await y.getIncrementalCache(e,x,T,V);null==B||B.resetRequestCache(),globalThis.__incrementalCache=B;let F={params:E,previewProps:T.preview,renderOpts:{experimental:{authInterrupts:!!x.experimental.authInterrupts,useCacheTimeout:x.experimental.useCacheTimeout},cacheComponents:!!x.cacheComponents,validationLevel:x.experimental.instantInsights.validationLevel,supportsDynamicResponse:K,incrementalCache:B,hmrRefreshHash:(0,a.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:x.cacheLife,staticPageGenerationTimeout:x.staticPageGenerationTimeout,waitUntil:s.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,s,a)=>y.onRequestError(e,t,s,a,b)},sharedContext:{buildId:A,deploymentId:w}},W=new l.NodeNextRequest(e),z=new l.NodeNextResponse(t),Z=d.NextRequestAdapter.fromNodeNextRequest(W,(0,d.signalFromNodeResponse)(t)),X=async({previousCacheEntry:n})=>{try{if(!V&&_&&C&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let a=await y.handle(Z,F);e.fetchMetrics=F.renderOpts.fetchMetrics;let r=F.renderOpts.pendingWaitUntil;r&&s.waitUntil&&(s.waitUntil(r),r=void 0);let i=F.renderOpts.collectedTags;if(!I)return await (0,p.sendResponse)(W,z,a,r),null;{let e=await a.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(a.headers);i&&(t[v.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==F.renderOpts.collectedRevalidate&&!(F.renderOpts.collectedRevalidate>=v.INFINITE_CACHE)&&F.renderOpts.collectedRevalidate,s=void 0===F.renderOpts.collectedExpire||F.renderOpts.collectedExpire>=v.INFINITE_CACHE?!1!==n&&n>0?x.expireTime:void 0:F.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:a.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:s}}}}catch(t){throw(null==n?void 0:n.isStale)&&await y.onRequestError(e,t,{routerKind:"App Router",routePath:$,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:_})},!1,b),t}},J=async(a,i)=>{try{var o,l;let a=await y.handleResponse({req:e,nextConfig:x,cacheKey:D,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:T,isRoutePPREnabled:!1,isOnDemandRevalidate:_,revalidateOnlyGenerated:C,responseGenerator:X,waitUntil:s.waitUntil,isMinimalMode:V});if(!I)return;if((null==a||null==(o=a.value)?void 0:o.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==a||null==(l=a.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});V||t.setHeader("x-nextjs-cache",_?"REVALIDATED":a.isMiss?"MISS":a.isStale?"STALE":"HIT"),P&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let r=(0,m.fromNodeOutgoingHttpHeaders)(a.value.headers);V&&I||r.delete(v.NEXT_CACHE_TAGS_HEADER),!a.cacheControl||t.getHeader("Cache-Control")||r.get("Cache-Control")||r.set("Cache-Control",(0,h.getCacheControlHeader)(a.cacheControl)),await (0,p.sendResponse)(W,z,new Response(a.value.body,{headers:r,status:a.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await y.onRequestError(e,t,{routerKind:"App Router",routePath:O,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:_})},!1,b),I)throw t;await (0,p.sendResponse)(W,z,new Response(null,{status:500}));return}finally{(()=>{if(!a)return;let e=t.statusCode;a.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(a.setStatus({code:r.SpanStatusCode.ERROR}),a.setAttribute("error.type",e.toString()));let n=M.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==u.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let s=n.get("next.route")||O,o=`${G} ${s}`;a.setAttributes({"next.route":s,"http.route":s,"next.span_name":o}),a.updateName(o),i&&i!==a&&(i.setAttribute("http.route",s),i.updateName(o))})()}};if(H&&j)await J(j,void 0);else{let t=M.getActiveScopeSpan();await M.withPropagatedContext(e.headers,()=>M.trace(u.BaseServerSpan.handleRequest,{spanName:`${G} ${$}`,kind:r.SpanKind.SERVER,attributes:{"http.method":G,"http.target":e.url}},e=>J(e,t)),void 0,!H)}}e.s(["handler",0,w,"patchFetch",0,function(){return(0,s.patchFetch)({workAsyncStorage:$,workUnitAsyncStorage:R})},"routeModule",0,y,"serverHooks",0,A,"workAsyncStorage",0,$,"workUnitAsyncStorage",0,R])},89460,e=>{"use strict";var t=e.i(64328);let n=new t.default.Schema({userId:{type:String,default:null,index:!0},username:{type:String,default:null},connectionId:{type:String,default:null,index:!0},host:{type:String,default:null},appName:{type:String,default:null},action:{type:String,required:!0},version:{type:String,default:null},success:{type:Boolean,default:!1},exitCode:{type:Number,default:null},error:{type:String,default:null},ip:{type:String,default:null},createdAt:{type:Date,default:Date.now,index:!0}},{timestamps:!1,versionKey:!1});n.index({createdAt:1},{expireAfterSeconds:7776e3}),n.index({userId:1,createdAt:-1}),n.index({connectionId:1,createdAt:-1}),t.default.models.AuditLog||t.default.model("AuditLog",n),e.s(["getAuditLogModel",0,function(e){let s=e||t.default;return s.models.AuditLog||s.model("AuditLog",n)}])}];

//# sourceMappingURL=_15um_mz._.js.map