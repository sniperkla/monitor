module.exports=[23793,e=>e.a(async(t,r)=>{try{var n=e.i(89171),o=e.i(47185),s=e.i(51631),i=t([o]);function a(e){let t=e.trim().split(/\s+/);if(t.length<5)return e;let[r,n,o,s,i]=t;return"0"===r&&"*"===n&&"*"===o&&"*"===s&&"*"===i?"Every Hour":"*/15"===r&&"*"===n&&"*"===o&&"*"===s&&"*"===i?"Every 15 Minutes":"*/30"===r&&"*"===n&&"*"===o&&"*"===s&&"*"===i?"Every 30 Minutes":"0"===r&&"0"===n&&"*"===o&&"*"===s&&"*"===i?"Every Day at Midnight (00:00)":"0"===r&&"2"===n&&"*"===o&&"*"===s&&"*"===i?"Every Day at 02:00 AM":"0"===r&&"0"===n&&"*"===o&&"*"===s&&"0"===i?"Every Sunday at Midnight":"0"===r&&"0"===n&&"1"===o&&"*"===s&&"*"===i?"1st Day of Every Month":`Schedule: ${e}`}async function l(e){try{let{searchParams:t}=new URL(e.url),r=t.get("connectionId");if(!r)return n.NextResponse.json({success:!1,error:"connectionId is required"},{status:400});let s=e.headers.get("x-ssh-mode"),i=e.headers.get("x-preferred-relay"),l=await (0,o.getSshConfig)(r,{sshMode:s,preferredRelay:i}),c=`
(crontab -l 2>/dev/null || true)
echo "=== CRON_SCRIPTS_START ==="
for s in $HOME/.rclone-scripts/rclone-cron-*.sh /tmp/rclone-cron-*.sh; do
  if [ -f "$s" ]; then
    echo "=== SCRIPT_FILE: $s ==="
    cat "$s"
    echo ""
  fi
done
`,d=((await (0,o.execCommand)(l,c)).stdout||"").split("=== CRON_SCRIPTS_START ==="),u=d[0]||"",p=d.slice(1).join("=== CRON_SCRIPTS_START ==="),$={};if(p)for(let e of p.split("=== SCRIPT_FILE: ").filter(Boolean)){let t=e.indexOf("\n");if(-1===t)continue;let r=e.slice(0,t).replace(/\s*===\s*$/,"").trim(),n=e.slice(t+1),o=n.match(/# RCLONE_META_SOURCE:\s*(.*)/)?.[1]?.trim(),s=n.match(/# RCLONE_META_TARGET:\s*(.*)/)?.[1]?.trim(),i=n.match(/# RCLONE_META_ACTION:\s*(.*)/)?.[1]?.trim(),a=n.match(/# RCLONE_META_PROJECT:\s*(.*)/)?.[1]?.trim(),l=n.match(/# RCLONE_META_OPTIONS:\s*(.*)/)?.[1]?.trim(),c={};if(l)try{c=JSON.parse(l)}catch(e){}let d=o||"",u=s||"",p=i||"copy";if(!d||!u){let e=n.match(/(?:nice\s+-n\s+\d+\s+)?"?\$?RCLONE_BIN"?\s+(copy|sync|move|check)\s+"([^"]+)"\s+"([^"]+)"/i)||n.match(/(?:nice\s+-n\s+\d+\s+)?rclone\s+(copy|sync|move|check)\s+"([^"]+)"\s+"([^"]+)"/i);e&&(p||(p=e[1].toLowerCase()),d||(d=e[2]),u||(u=e[3].replace(/\/+\$\(date[^)]+\)/g,"").replace(/\/+$/,"")))}let h=r.split("/").pop();$[r]={source:d,target:u,action:p,projectName:a||"",options:c,baseName:h},h&&($[h]=$[r])}let h=(u||"").split("\n").map(e=>e.trim()).filter(Boolean),m=[];return h.forEach((e,t)=>{if(e.startsWith("#"))return;let r=e.split(/\s+/);if(r.length>=6){let n=r.slice(0,5).join(" "),o=r.slice(5).join(" "),s=o.toLowerCase().includes("rclone"),i="",l="",c="copy",d="",u={},p=o.match(/(\S+\.sh)/);if(p){let e=p[1],t=e.split("/").pop(),r=$[e]||$[t];r&&(i=r.source||"",l=r.target||"",c=r.action||"copy",d=r.projectName||"",u=r.options||{})}if(!i||!l){let e=o.match(/rclone\s+(copy|sync|move|check)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);e&&(c=e[1]?e[1].toLowerCase():"copy",i=e[2]||e[3]||e[4]||"",l=(l=e[5]||e[6]||e[7]||"").replace(/\/+\$\(date[^)]+\)/g,"").replace(/\/+$/,""))}if(0===Object.keys(u).length){let t=e.match(/--min-age\s+(\d+)d/);u={useTimestampFolder:e.includes("$(date")||o.includes("$(date"),timestampFormat:e.includes("%b")||o.includes("%b")?"YMD_MMM_HM":e.includes("%d-%m-%Y")||o.includes("%d-%m-%Y")?"DMY_HM":"YMD_HMS",enableRetention:!!t,retentionDays:t?t[1]:"7"}}m.push({id:t,schedule:n,humanSchedule:a(n),command:o,isRclone:s,raw:e,source:i,target:l,action:c,projectName:d,options:u})}}),n.NextResponse.json({success:!0,jobs:m})}catch(e){return s.logger.error("[rclone/cron GET] error:",e.message),n.NextResponse.json({success:!1,error:e.message},{status:500})}}function c(e){return`'${String(e).replace(/'/g,"'\\''")}'`}async function d(e){try{let{connectionId:t,schedule:r,action:s,source:i,target:l,projectName:d,options:u={}}=await e.json(),p=d||"";if(!t||!r||!i||!l)return n.NextResponse.json({success:!1,error:"connectionId, schedule, source, and target are required"},{status:400});let $=e.headers.get("x-ssh-mode"),h=e.headers.get("x-preferred-relay"),m=await (0,o.getSshConfig)(t,{sshMode:$,preferredRelay:h}),R=i.trim();for(;R.includes("$HOME/$HOME/")||R.includes("$HOME/$HOME");)R=R.replace(/\$HOME\/\$HOME/g,"$HOME");R.includes(":")||R.startsWith("/")||R.startsWith("$HOME")||R.startsWith("~")||(R=R.startsWith("./")?`$HOME/${R.slice(2)}`:`$HOME/${R}`);let f=2048;try{let e=await (0,o.execCommand)(m,"free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048'");f=parseInt((e.stdout||"").trim(),10)||2048}catch(e){}let E=["--progress","--stats=1s"];if(u.dryRun&&E.push("--dry-run"),u.bwlimit&&E.push(`--bwlimit "${u.bwlimit}"`),u.transfers&&E.push(`--transfers ${u.transfers}`),u.driveFolderId&&u.driveFolderId.trim()&&E.push(`--drive-root-folder-id "${u.driveFolderId.trim()}"`),u.transfers||(f<=2048?E.push("--transfers 1 --checkers 2"):f<=8192?E.push("--transfers 2 --checkers 4"):E.push("--transfers 4 --checkers 8")),E.push(f<=2048?"--buffer-size 16M":"--buffer-size 32M"),l.includes(":")){let e=l.toLowerCase();(e.startsWith("gdrive")||e.includes("drive"))&&E.push("--drive-chunk-size 32M")}let O=R?R.split("/").filter(Boolean).pop()||R:"Source",C=l?l.split("/")[0]:"Destination",_=p.trim()?p.trim().replace(/"/g,""):`${O} ➔ ${C}`,g=_.replace(/[^a-zA-Z0-9_-]/g,"_");E.push('--log-file="$LOG"'),E.push("--log-level INFO");let N=f<=2048?"nice -n 19 ":"",v=l;if(u.useTimestampFolder){let e="%Y-%m-%d_%H-%M-%S";"YMD_MMM_HM"===u.timestampFormat?e="%Y_%b_%d_%H_%M":"DMY_HM"===u.timestampFormat&&(e="%d-%m-%Y_%H-%M");let t=l.replace(/\/$/,"");v=`${t}/$(date +${e})/`}let M=`$HOME/.rclone-scripts/rclone-cron-${g}.sh`,T="";if(u.enableRetention&&u.retentionDays){let e=parseInt(u.retentionDays,10)||7,t=u.driveFolderId&&u.driveFolderId.trim()?`--drive-root-folder-id "${u.driveFolderId.trim()}" `:"";T=`"$RCLONE_BIN" delete --min-age ${e}d "${l}" ${t}--rmdirs 2>/dev/null || true`}let I=`#!/bin/bash
# RCLONE_META_PROJECT: ${_}
# RCLONE_META_ACTION: ${s||"copy"}
# RCLONE_META_SOURCE: ${R}
# RCLONE_META_TARGET: ${l}
# RCLONE_META_OPTIONS: ${JSON.stringify(u)}
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"

# Auto-detect rclone binary
RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "$HOME/.local/bin/rclone")"
if [ ! -x "$RCLONE_BIN" ] && ! command -v rclone >/dev/null 2>&1; then
  RCLONE_BIN="rclone"
fi

# Auto-detect rclone config file
if [ -z "$RCLONE_CONFIG" ]; then
  if [ -f "$HOME/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="$HOME/.config/rclone/rclone.conf"
  elif [ -f "/root/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/root/.config/rclone/rclone.conf"
  elif [ -f "/etc/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/etc/rclone/rclone.conf"
  fi
fi

SCRIPTS_DIR="$HOME/.rclone-scripts"
LOGS_DIR="$SCRIPTS_DIR/logs"
mkdir -p "$LOGS_DIR" 2>/dev/null || mkdir -p /tmp/rclone-logs 2>/dev/null

LOG="$LOGS_DIR/rclone-cron-${g}-$(date +%s).log"
LOCKFILE="$SCRIPTS_DIR/rclone-lock-${g}.lock"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCKFILE"
  flock -n 9 || { exit 0; }
else
  LOCKDIR="$SCRIPTS_DIR/rclone-lock-${g}.lockdir"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then exit 0; fi
  trap 'rm -rf "$LOCKDIR"' EXIT
fi

echo "=== Project: ${_} | Action: ${s||"copy"} ===" >> "$LOG"

${N}"$RCLONE_BIN" ${s||"copy"} "${R}" "${v}" ${E.join(" ")} >> "$LOG" 2>&1

${T?`${T}
`:""}
find "$LOGS_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null || true
`,S=`${r} /bin/bash ${M}`,y=[];u.driveFolderId&&u.driveFolderId.trim()&&y.push(`--drive-root-folder-id "${u.driveFolderId.trim()}"`);let b=`export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"; RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "rclone")"; "$RCLONE_BIN" ${s||"copy"} "${R}" "${l}" --dry-run ${y.join(" ")} 2>&1 | head -15`,L=await (0,o.execCommand)(m,b),A=`
mkdir -p "$HOME/.rclone-scripts/logs"
cat <<'SCRIPTEOF' > ${M}
${I}
SCRIPTEOF
chmod +x ${M}
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${c(M)} | grep -F -v ${c(g)} > "$TMP_CRON" || true
cat <<'CRONEOF' >> "$TMP_CRON"
${S}
CRONEOF
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`,P=await (0,o.execCommand)(m,A);if(0===P.code)return n.NextResponse.json({success:!0,message:"Crontab job added successfully!",schedule:r,humanSchedule:a(r),cronLine:S,testPassed:0===L.code,testOutput:L.stdout||"Test dry-run completed cleanly."});return n.NextResponse.json({success:!1,error:P.stderr||"Failed to add crontab job"},{status:500})}catch(e){return s.logger.error("[rclone/cron POST] error:",e.message),n.NextResponse.json({success:!1,error:e.message},{status:500})}}async function u(e){try{let{connectionId:t,oldRawLine:r,schedule:s,action:i,source:l,target:d,options:u={}}=await e.json();if(!t||!r||!s||!l||!d)return n.NextResponse.json({success:!1,error:"connectionId, oldRawLine, schedule, source, and target are required"},{status:400});let p=e.headers.get("x-ssh-mode"),$=e.headers.get("x-preferred-relay"),h=await (0,o.getSshConfig)(t,{sshMode:p,preferredRelay:$}),m=l.trim();for(;m.includes("$HOME/$HOME/")||m.includes("$HOME/$HOME");)m=m.replace(/\$HOME\/\$HOME/g,"$HOME");m.includes(":")||m.startsWith("/")||m.startsWith("$HOME")||m.startsWith("~")||(m=m.startsWith("./")?`$HOME/${m.slice(2)}`:`$HOME/${m}`);let R=m?m.split("/").filter(Boolean).pop()||m:"Source",f=d?d.split("/")[0]:"Destination",E=u.projectName||`${R} ➔ ${f}`,O=E.replace(/[^a-zA-Z0-9_-]/g,"_"),C=["--progress","--stats=1s"];u.dryRun&&C.push("--dry-run"),u.bwlimit&&C.push(`--bwlimit "${u.bwlimit}"`),u.transfers&&C.push(`--transfers ${u.transfers}`),u.driveFolderId&&u.driveFolderId.trim()&&C.push(`--drive-root-folder-id "${u.driveFolderId.trim()}"`);let _=2048;try{let e=await (0,o.execCommand)(h,"free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048'");_=parseInt((e.stdout||"").trim(),10)||2048}catch(e){}if(u.transfers||(_<=2048?C.push("--transfers 1 --checkers 2"):_<=8192?C.push("--transfers 2 --checkers 4"):C.push("--transfers 4 --checkers 8")),C.push(_<=2048?"--buffer-size 16M":"--buffer-size 32M"),d.includes(":")){let e=d.toLowerCase();(e.startsWith("gdrive")||e.includes("drive"))&&C.push("--drive-chunk-size 32M")}let g=_<=2048?"nice -n 19 ":"";C.push('--log-file="$LOG"'),C.push("--log-level INFO");let N="";if(u.enableRetention&&u.retentionDays){let e=parseInt(u.retentionDays,10)||7,t=u.driveFolderId&&u.driveFolderId.trim()?`--drive-root-folder-id "${u.driveFolderId.trim()}" `:"";N=`"$RCLONE_BIN" delete --min-age ${e}d "${d}" ${t}--rmdirs 2>/dev/null || true`}let v=d;if(u.useTimestampFolder){let e="%Y-%m-%d_%H-%M-%S";"YMD_MMM_HM"===u.timestampFormat?e="%Y_%b_%d_%H_%M":"DMY_HM"===u.timestampFormat&&(e="%d-%m-%Y_%H-%M");let t=d.replace(/\/$/,"");v=`${t}/$(date +${e})/`}let M=`$HOME/.rclone-scripts/rclone-cron-${O}.sh`,T=`#!/bin/bash
# RCLONE_META_PROJECT: ${E}
# RCLONE_META_ACTION: ${i||"copy"}
# RCLONE_META_SOURCE: ${m}
# RCLONE_META_TARGET: ${d}
# RCLONE_META_OPTIONS: ${JSON.stringify(u)}
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"

RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "$HOME/.local/bin/rclone")"
if [ ! -x "$RCLONE_BIN" ] && ! command -v rclone >/dev/null 2>&1; then
  RCLONE_BIN="rclone"
fi

if [ -z "$RCLONE_CONFIG" ]; then
  if [ -f "$HOME/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="$HOME/.config/rclone/rclone.conf"
  elif [ -f "/root/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/root/.config/rclone/rclone.conf"
  elif [ -f "/etc/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/etc/rclone/rclone.conf"
  fi
fi

SCRIPTS_DIR="$HOME/.rclone-scripts"
LOGS_DIR="$SCRIPTS_DIR/logs"
mkdir -p "$LOGS_DIR" 2>/dev/null || mkdir -p /tmp/rclone-logs 2>/dev/null

LOG="$LOGS_DIR/rclone-cron-${O}-$(date +%s).log"
LOCKFILE="$SCRIPTS_DIR/rclone-lock-${O}.lock"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCKFILE"
  flock -n 9 || { exit 0; }
else
  LOCKDIR="$SCRIPTS_DIR/rclone-lock-${O}.lockdir"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then exit 0; fi
  trap 'rm -rf "$LOCKDIR"' EXIT
fi

echo "=== Project: ${E} | Action: ${i||"copy"} ===" >> "$LOG"

${g}"$RCLONE_BIN" ${i||"copy"} "${m}" "${v}" ${C.join(" ")} >> "$LOG" 2>&1

${N?`${N}
`:""}
find "$LOGS_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null || true
`,I=`${s} /bin/bash ${M}`,S=`
mkdir -p "$HOME/.rclone-scripts/logs"
rm -f ${M} /tmp/rclone-cron-${O}.sh
cat <<'SCRIPTEOF' > ${M}
${T}
SCRIPTEOF
chmod +x ${M}
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${c(M)} | grep -F -v ${c(r)} | grep -F -v ${c(O)} > "$TMP_CRON" || true
cat <<'CRONEOF' >> "$TMP_CRON"
${I}
CRONEOF
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`,y=await (0,o.execCommand)(h,S);if(0===y.code)return n.NextResponse.json({success:!0,message:"Crontab job updated successfully!",schedule:s,humanSchedule:a(s),cronLine:I});return n.NextResponse.json({success:!1,error:y.stderr||"Failed to update crontab job"},{status:500})}catch(e){return s.logger.error("[rclone/cron PUT] error:",e.message),n.NextResponse.json({success:!1,error:e.message},{status:500})}}async function p(e){try{let{searchParams:t}=new URL(e.url),r=t.get("connectionId"),s=t.get("rawLine"),i="true"===t.get("removeScript");if(!r||!s)return n.NextResponse.json({success:!1,error:"connectionId and rawLine are required"},{status:400});let a=e.headers.get("x-ssh-mode"),l=e.headers.get("x-preferred-relay"),d=await (0,o.getSshConfig)(r,{sshMode:a,preferredRelay:l}),u=c(s),p=`
RAW_LINE=${u}

# Extract script path ending with rclone-cron-*.sh
SCRIPT_PATH=$(echo "$RAW_LINE" | awk '{for(i=1;i<=NF;i++) if($i ~ /rclone-cron-.*\\.sh$/) print $i}')

TMP_CRON=$(mktemp)
if [ -n "$SCRIPT_PATH" ]; then
  crontab -l 2>/dev/null | grep -F -v "$RAW_LINE" | grep -F -v "$SCRIPT_PATH" > "$TMP_CRON" || true
  ${i?`rm -f "$SCRIPT_PATH"
  BASE_NAME=$(basename "$SCRIPT_PATH" .sh)
  rm -rf "$HOME/.rclone-scripts/$BASE_NAME"* "$HOME/.rclone-scripts/logs/$BASE_NAME"* "/tmp/$BASE_NAME"* "/tmp/rclone-logs/$BASE_NAME"* 2>/dev/null || true`:"# Keep script & log files as requested"}
else
  crontab -l 2>/dev/null | grep -F -v "$RAW_LINE" > "$TMP_CRON" || true
fi

crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`,$=await (0,o.execCommand)(d,p);return n.NextResponse.json({success:0===$.code,error:0!==$.code?$.stderr:null})}catch(e){return s.logger.error("[rclone/cron DELETE] error:",e.message),n.NextResponse.json({success:!1,error:e.message},{status:500})}}[o]=i.then?(await i)():i,e.s(["DELETE",0,p,"GET",0,l,"POST",0,d,"PUT",0,u]),r()}catch(e){r(e)}},!1),67134,e=>{"use strict";var t=e.i(8970),r=e.i(74017),n=e.i(96250),o=e.i(59756),s=e.i(61916),i=e.i(74677),a=e.i(69741),l=e.i(16795),c=e.i(87718),d=e.i(95169),u=e.i(47587),p=e.i(66012),$=e.i(70101),h=e.i(26937),m=e.i(10372),R=e.i(93695);e.i(52474);var f=e.i(5232);let E=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/rclone/cron/route",pathname:"/api/rclone/cron",filename:"route",bundlePath:""},distDir:".next-security-verify",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/rclone/cron/route.js",nextConfigOutput:"",userland:()=>e.r(23793),...{}}),{workAsyncStorage:O,workUnitAsyncStorage:C,serverHooks:_}=E;async function g(e,t,n){n.requestMeta&&(0,o.setRequestMeta)(e,n.requestMeta),E.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let O="/api/rclone/cron/route";O=O.replace(/\/index$/,"")||"/";let C=await E.prepare(e,t,{srcPage:O,multiZoneDraftMode:!1});if(!C)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:_,deploymentId:g,params:N,nextConfig:v,parsedUrl:M,isDraftMode:T,prerenderManifest:I,routerServerContext:S,isOnDemandRevalidate:y,revalidateOnlyGenerated:b,resolvedPathname:L,clientReferenceManifest:A,serverActionsManifest:P}=C,H=(0,a.normalizeAppPath)(O),x=!!(I.dynamicRoutes[H]||I.routes[L]),w=async()=>((null==S?void 0:S.render404)?await S.render404(e,t,M,!1):t.end("This page could not be found"),null);if(x&&!T){let e=!!I.routes[L],t=I.dynamicRoutes[H];if(t&&!1===t.fallback&&!e){if(v.adapterPath)return await w();throw new R.NoFallbackError}}let F=null;!x||E.isDev||T||(F="/index"===(F=L)?"/":F);let D=!0===E.isDev||!x,k=x&&!D;P&&A&&(0,i.setManifestsSingleton)({page:O,clientReferenceManifest:A,serverActionsManifest:P});let j=e.method||"GET",G=(0,s.getTracer)(),B=G.getActiveScopeSpan(),q=!!(null==S?void 0:S.isWrappedByNextServer),U=!!(0,o.getRequestMeta)(e,"minimalMode"),K=(0,o.getRequestMeta)(e,"incrementalCache")||await E.getIncrementalCache(e,v,I,U);null==K||K.resetRequestCache(),globalThis.__incrementalCache=K;let W={params:N,previewProps:I.preview,renderOpts:{experimental:{authInterrupts:!!v.experimental.authInterrupts,useCacheTimeout:v.experimental.useCacheTimeout},cacheComponents:!!v.cacheComponents,validationLevel:v.experimental.instantInsights.validationLevel,supportsDynamicResponse:D,incrementalCache:K,hmrRefreshHash:(0,o.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:v.cacheLife,staticPageGenerationTimeout:v.staticPageGenerationTimeout,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,n,o)=>E.onRequestError(e,t,n,o,S)},sharedContext:{buildId:_,deploymentId:g}},Y=new l.NodeNextRequest(e),z=new l.NodeNextResponse(t),J=c.NextRequestAdapter.fromNodeNextRequest(Y,(0,c.signalFromNodeResponse)(t)),X=async({previousCacheEntry:r})=>{try{if(!U&&y&&b&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await E.handle(J,W);e.fetchMetrics=W.renderOpts.fetchMetrics;let s=W.renderOpts.pendingWaitUntil;s&&n.waitUntil&&(n.waitUntil(s),s=void 0);let i=W.renderOpts.collectedTags;if(!x)return await (0,p.sendResponse)(Y,z,o,s),null;{let e=await o.blob(),t=(0,$.toNodeOutgoingHttpHeaders)(o.headers);i&&(t[m.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==W.renderOpts.collectedRevalidate&&!(W.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&W.renderOpts.collectedRevalidate,n=void 0===W.renderOpts.collectedExpire||W.renderOpts.collectedExpire>=m.INFINITE_CACHE?!1!==r&&r>0?v.expireTime:void 0:W.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:n}}}}catch(t){throw(null==r?void 0:r.isStale)&&await E.onRequestError(e,t,{routerKind:"App Router",routePath:O,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:k,isOnDemandRevalidate:y})},!1,S),t}},V=async(o,i)=>{try{var a,l;let o=await E.handleResponse({req:e,nextConfig:v,cacheKey:F,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:I,isRoutePPREnabled:!1,isOnDemandRevalidate:y,revalidateOnlyGenerated:b,responseGenerator:X,waitUntil:n.waitUntil,isMinimalMode:U});if(!x)return;if((null==o||null==(a=o.value)?void 0:a.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==o||null==(l=o.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});U||t.setHeader("x-nextjs-cache",y?"REVALIDATED":o.isMiss?"MISS":o.isStale?"STALE":"HIT"),T&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let s=(0,$.fromNodeOutgoingHttpHeaders)(o.value.headers);U&&x||s.delete(m.NEXT_CACHE_TAGS_HEADER),!o.cacheControl||t.getHeader("Cache-Control")||s.get("Cache-Control")||s.set("Cache-Control",(0,h.getCacheControlHeader)(o.cacheControl)),await (0,p.sendResponse)(Y,z,new Response(o.value.body,{headers:s,status:o.value.status||200}));return}catch(t){if(t instanceof R.NoFallbackError||await E.onRequestError(e,t,{routerKind:"App Router",routePath:H,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:k,isOnDemandRevalidate:y})},!1,S),x)throw t;await (0,p.sendResponse)(Y,z,new Response(null,{status:500}));return}finally{(()=>{if(!o)return;let e=t.statusCode;o.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(o.setStatus({code:s.SpanStatusCode.ERROR}),o.setAttribute("error.type",e.toString()));let r=G.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==d.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=r.get("next.route")||H,a=`${j} ${n}`;o.setAttributes({"next.route":n,"http.route":n,"next.span_name":a}),o.updateName(a),i&&i!==o&&(i.setAttribute("http.route",n),i.updateName(a))})()}};if(q&&B)await V(B,void 0);else{let t=G.getActiveScopeSpan();await G.withPropagatedContext(e.headers,()=>G.trace(d.BaseServerSpan.handleRequest,{spanName:`${j} ${O}`,kind:s.SpanKind.SERVER,attributes:{"http.method":j,"http.target":e.url}},e=>V(e,t)),void 0,!q)}}e.s(["handler",0,g,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:O,workUnitAsyncStorage:C})},"routeModule",0,E,"serverHooks",0,_,"workAsyncStorage",0,O,"workUnitAsyncStorage",0,C])}];

//# sourceMappingURL=_12lcspq._.js.map