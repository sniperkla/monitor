module.exports=[78671,e=>e.a(async(t,r)=>{try{var a=e.i(89171),o=e.i(23667),n=e.i(80533),i=e.i(46589),s=e.i(40317),l=e.i(51631),c=t([n,i]);async function d(e){try{let t=await (0,o.getServerSession)(n.authOptions);if(!t)return a.NextResponse.json({success:!1,error:"Unauthorized"},{status:401});let r=t.user?.id;if(!r)return a.NextResponse.json({success:!1,error:"User ID not found in session"},{status:400});let c=e.nextUrl.searchParams.get("code");if(!c)return new a.NextResponse("<h1>Authorization failed: missing auth code</h1>",{headers:{"Content-Type":"text/html"}});let d=await (0,i.default)(),u=new s.SystemSettingRepository(d,r);await u.init();let p=await u.findOne({key:"google_drive_config"}),h=p?p.value:{},g=h?.clientId||process.env.GOOGLE_CLIENT_ID,m=h?.clientSecret||process.env.GOOGLE_CLIENT_SECRET;if(!g||!m)return new a.NextResponse("<h1>Configuration Error: Client ID or Secret missing</h1>",{headers:{"Content-Type":"text/html"}});let f=process.env.GDRIVE_REDIRECT_URI;if(!f){let t=process.env.NEXTAUTH_URL;if(!t||t.includes("localhost")){let r=e.headers.get("x-forwarded-proto"),a=e.headers.get("x-forwarded-host")||e.headers.get("host");if(a){let e=r||(a.includes("localhost")?"http":"https");t=`${e}://${a}`}else t=e.nextUrl.origin}f=`${t.replace(/\/$/,"")}/api/mongo-sync/gdrive/callback`}let v=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:g,client_secret:m,code:c,redirect_uri:f,grant_type:"authorization_code"})}),R=await v.json();if(R.error)return new a.NextResponse(`<h1>Token exchange failed: ${R.error_description||R.error}</h1>`,{headers:{"Content-Type":"text/html"}});let{access_token:w,refresh_token:x,expires_in:y}=R,b={};try{let e=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:`Bearer ${w}`}});b=await e.json()}catch(e){l.logger.error("Failed to fetch Google user info:",e)}let E={...h,clientId:g||h.clientId,clientSecret:m||h.clientSecret,accessToken:w,refreshToken:x||h.refreshToken,expiresAt:Date.now()+1e3*y,connectedAt:Date.now(),email:b.email||"linked-account@google.com",name:b.name||"Google Drive Sync",picture:b.picture||""};await u.upsert("google_drive_config",E);let C=`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Drive Authorized</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          .card {
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(99, 102, 241, 0.2);
            padding: 2.5rem;
            border-radius: 1.5rem;
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5);
            backdrop-filter: blur(12px);
            max-width: 400px;
          }
          h1 {
            color: #10b981;
            margin-bottom: 1rem;
            font-size: 1.5rem;
          }
          p {
            color: #94a3b8;
            font-size: 0.9rem;
            line-height: 1.5;
            margin-bottom: 2rem;
          }
          .spinner {
            border: 3px solid rgba(16, 185, 129, 0.1);
            width: 36px;
            height: 36px;
            clear: both;
            margin: 0.5rem auto;
            border-top-color: #10b981;
            border-radius: 50%;
            animation: spin 1s infinite linear;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google Drive Linked!</h1>
          <p>Your Google Drive account has been connected successfully as <strong>${E.email.replace(/[<>&"']/g,e=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"})[e])}</strong>.</p>
          <div class="spinner"></div>
          <p style="margin-top: 1.5rem; font-size: 0.8rem; color: #64748b;">This window will close automatically...</p>
        </div>
        <script>
          setTimeout(() => {
            window.close();
          }, 2000);
        </script>
      </body>
      </html>
    `;return new a.NextResponse(C,{headers:{"Content-Type":"text/html"}})}catch(e){return l.logger.error("Google Drive Callback error:",e),new a.NextResponse(`<h1>Internal Server Error: ${e.message}</h1>`,{headers:{"Content-Type":"text/html"}})}}[n,i]=c.then?(await c)():c,e.s(["GET",0,d]),r()}catch(e){r(e)}},!1),31608,e=>{"use strict";var t=e.i(8970),r=e.i(74017),a=e.i(96250),o=e.i(59756),n=e.i(61916),i=e.i(74677),s=e.i(69741),l=e.i(16795),c=e.i(87718),d=e.i(95169),u=e.i(47587),p=e.i(66012),h=e.i(70101),g=e.i(26937),m=e.i(10372),f=e.i(93695);e.i(52474);var v=e.i(5232);let R=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/mongo-sync/gdrive/callback/route",pathname:"/api/mongo-sync/gdrive/callback",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/mongo-sync/gdrive/callback/route.js",nextConfigOutput:"",userland:()=>e.r(78671),...{}}),{workAsyncStorage:w,workUnitAsyncStorage:x,serverHooks:y}=R;async function b(e,t,a){a.requestMeta&&(0,o.setRequestMeta)(e,a.requestMeta),R.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let w="/api/mongo-sync/gdrive/callback/route";w=w.replace(/\/index$/,"")||"/";let x=await R.prepare(e,t,{srcPage:w,multiZoneDraftMode:!1});if(!x)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:y,deploymentId:b,params:E,nextConfig:C,parsedUrl:T,isDraftMode:S,prerenderManifest:A,routerServerContext:_,isOnDemandRevalidate:N,revalidateOnlyGenerated:k,resolvedPathname:I,clientReferenceManifest:P,serverActionsManifest:O}=x,D=(0,s.normalizeAppPath)(w),U=!!(A.dynamicRoutes[D]||A.routes[I]),H=async()=>((null==_?void 0:_.render404)?await _.render404(e,t,T,!1):t.end("This page could not be found"),null);if(U&&!S){let e=!!A.routes[I],t=A.dynamicRoutes[D];if(t&&!1===t.fallback&&!e){if(C.adapterPath)return await H();throw new f.NoFallbackError}}let q=null;!U||R.isDev||S||(q="/index"===(q=I)?"/":q);let G=!0===R.isDev||!U,M=U&&!G;O&&P&&(0,i.setManifestsSingleton)({page:w,clientReferenceManifest:P,serverActionsManifest:O});let $=e.method||"GET",L=(0,n.getTracer)(),j=L.getActiveScopeSpan(),F=!!(null==_?void 0:_.isWrappedByNextServer),z=!!(0,o.getRequestMeta)(e,"minimalMode"),B=(0,o.getRequestMeta)(e,"incrementalCache")||await R.getIncrementalCache(e,C,A,z);null==B||B.resetRequestCache(),globalThis.__incrementalCache=B;let K={params:E,previewProps:A.preview,renderOpts:{experimental:{authInterrupts:!!C.experimental.authInterrupts,useCacheTimeout:C.experimental.useCacheTimeout},cacheComponents:!!C.cacheComponents,validationLevel:C.experimental.instantInsights.validationLevel,supportsDynamicResponse:G,incrementalCache:B,hmrRefreshHash:(0,o.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:C.cacheLife,staticPageGenerationTimeout:C.staticPageGenerationTimeout,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,o)=>R.onRequestError(e,t,a,o,_)},sharedContext:{buildId:y,deploymentId:b}},V=new l.NodeNextRequest(e),X=new l.NodeNextResponse(t),W=c.NextRequestAdapter.fromNodeNextRequest(V,(0,c.signalFromNodeResponse)(t)),Y=async({previousCacheEntry:r})=>{try{if(!z&&N&&k&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await R.handle(W,K);e.fetchMetrics=K.renderOpts.fetchMetrics;let n=K.renderOpts.pendingWaitUntil;n&&a.waitUntil&&(a.waitUntil(n),n=void 0);let i=K.renderOpts.collectedTags;if(!U)return await (0,p.sendResponse)(V,X,o,n),null;{let e=await o.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(o.headers);i&&(t[m.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,a=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=m.INFINITE_CACHE?!1!==r&&r>0?C.expireTime:void 0:K.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await R.onRequestError(e,t,{routerKind:"App Router",routePath:w,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:N})},!1,_),t}},Z=async(o,i)=>{try{var s,l;let o=await R.handleResponse({req:e,nextConfig:C,cacheKey:q,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:A,isRoutePPREnabled:!1,isOnDemandRevalidate:N,revalidateOnlyGenerated:k,responseGenerator:Y,waitUntil:a.waitUntil,isMinimalMode:z});if(!U)return;if((null==o||null==(s=o.value)?void 0:s.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==o||null==(l=o.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});z||t.setHeader("x-nextjs-cache",N?"REVALIDATED":o.isMiss?"MISS":o.isStale?"STALE":"HIT"),S&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let n=(0,h.fromNodeOutgoingHttpHeaders)(o.value.headers);z&&U||n.delete(m.NEXT_CACHE_TAGS_HEADER),!o.cacheControl||t.getHeader("Cache-Control")||n.get("Cache-Control")||n.set("Cache-Control",(0,g.getCacheControlHeader)(o.cacheControl)),await (0,p.sendResponse)(V,X,new Response(o.value.body,{headers:n,status:o.value.status||200}));return}catch(t){if(t instanceof f.NoFallbackError||await R.onRequestError(e,t,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:N})},!1,_),U)throw t;await (0,p.sendResponse)(V,X,new Response(null,{status:500}));return}finally{(()=>{if(!o)return;let e=t.statusCode;o.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(o.setStatus({code:n.SpanStatusCode.ERROR}),o.setAttribute("error.type",e.toString()));let r=L.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route")||D,s=`${$} ${a}`;o.setAttributes({"next.route":a,"http.route":a,"next.span_name":s}),o.updateName(s),i&&i!==o&&(i.setAttribute("http.route",a),i.updateName(s))})()}};if(F&&j)await Z(j,void 0);else{let t=L.getActiveScopeSpan();await L.withPropagatedContext(e.headers,()=>L.trace(d.BaseServerSpan.handleRequest,{spanName:`${$} ${w}`,kind:n.SpanKind.SERVER,attributes:{"http.method":$,"http.target":e.url}},e=>Z(e,t)),void 0,!F)}}e.s(["handler",0,b,"patchFetch",0,function(){return(0,a.patchFetch)({workAsyncStorage:w,workUnitAsyncStorage:x})},"routeModule",0,R,"serverHooks",0,y,"workAsyncStorage",0,w,"workUnitAsyncStorage",0,x])}];

//# sourceMappingURL=_03x96hj._.js.map