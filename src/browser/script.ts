import { DEFAULT_EMBED_CHANNEL } from "./constants.js";
import { joinChunks } from "./chunks.js";
import { browserReadinessPolicy } from "./policy.js";
import { readonlyInstallSection, readonlyRuntimeHelpersSection } from "./readonly.js";
import { normalizeTransportRuntimeConfig } from "./transport.js";
import { createReadonlyBrowserPolicy } from "#3nojkzzzf31b";
import type {
  CodeServerBrowserDiagnosticsScriptOptions,
  CodeServerThemeSyncOptions,
} from "#3c8d8166992a";

function createBrowserDiagnosticsScript(
  options: CodeServerBrowserDiagnosticsScriptOptions = {},
): string {
  const policy = browserReadinessPolicy(options.policy);
  const bridgeProperty = options.bridgeProperty ?? "__CODE_SERVER_KIT_DIAGNOSTICS__";
  const readonly = createReadonlyBrowserPolicy(options.readonly);
  const transport = normalizeTransportRuntimeConfig(options.transport);
  const embed = {
    channel: options.embed?.channel ?? DEFAULT_EMBED_CHANNEL,
    enableParentStatus: options.embed?.enableParentStatus ?? false,
  };
  const theme = normalizeThemeSyncOptions(options.theme);

  return [
    "(function(){",
    `const bridgeProperty=${JSON.stringify(bridgeProperty)};`,
    `const policy=${JSON.stringify(policy)};`,
    `const readonlyPolicy=${JSON.stringify(readonly)};`,
    `const transport=${JSON.stringify(transport)};`,
    `const embed=${JSON.stringify(embed)};`,
    `const theme=${JSON.stringify(theme)};`,
    `const sessionKey=${JSON.stringify(options.sessionKey ?? null)};`,
    "const state={buffer:[],flushTimer:null,workbenchMounted:false,websocketReady:false,workerFailed:false,theme:null};",
    "const inIframe=window.parent && window.parent !== window;",
    runtimeHelpers(),
    transportSection(),
    readonlyRuntimeHelpersSection(),
    readonlyInstallSection(),
    fetchSection(),
    windowEventsSection(),
    workerAndWebSocketSection(),
    iframeSection(),
    themeSection(),
    workbenchSection(),
    "installReadonlyGuards();",
    "installFetchDiagnostics();",
    "installWindowDiagnostics();",
    "installServiceWorkerDiagnostics();",
    "installWorkerDiagnostics();",
    "installWebSocketDiagnostics();",
    "installIframeDiagnostics();",
    "themeBootstrap();",
    "if (document.readyState === 'interactive' || document.readyState === 'complete') detectShellLoaded();",
    "document.addEventListener('DOMContentLoaded', detectShellLoaded, { once: true });",
    "window.addEventListener('load', detectShellLoaded, { once: true });",
    "monitorWorkbench();",
    "})();",
  ].join("");
}

function runtimeHelpers(): string {
  return [
    "function now(){return new Date().toISOString();}",
    "function isAssetUrl(url){return typeof url==='string' && /(\\.js|\\.mjs|\\.css|\\.wasm|worker|static)/i.test(url);}",
    joinChunks([
        "function postEmbed(type,payload){if(!inIframe||!embed.enableParentStatus)return;try{window.p",
        "arent.postMessage({channel:embed.channel,payload:payload||{},timestamp:now(),type},transport",
        ".targetOrigin||'*');}catch{}}",
    ]),
    joinChunks([
        "function bridgeEmit(payload){try{const bridge=window[bridgeProperty];if(typeof bridge==='fun",
        "ction')bridge(payload);if(bridge&&typeof bridge.recordEvent==='function')bridge.recordEvent(",
        "payload);}catch(error){console.warn('code-server-kit diagnostics bridge failed',error);}}",
    ]),
    joinChunks([
        "function emit(type,level,summary,details){const payload={details:details||{},level:level||'i",
        "nfo',summary,timestamp:now(),type};bridgeEmit(payload);state.buffer.push(payload);scheduleFl",
        "ush();if(type==='workbench-mounted')postEmbed('ready',{event:payload,state:'ready'});if(type",
        "==='bootstrap-timeout'||level==='error'||type==='iframe-failure'||type==='iframe-timeout')po",
        "stEmbed('failure',{event:payload,state:'failed'});}",
    ]),
    joinChunks([
        "function emitReadonlyBlocked(kind,details){emit('readonly-guard','warn','readonly browser po",
        "licy blocked an action',Object.assign({kind,message:readonlyPolicy.browserGuards.readonlyMes",
        "sage},details||{}));}",
    ]),
    joinChunks([
        "function recordAssetResponse(url,status,contentType){if(!isAssetUrl(url))return;if(status===",
        "404){emit('asset-404','error','code-server asset returned 404',{resourceUrl:url,status});emi",
        "t('asset-missing','error','code-server asset appears to be missing',{resourceUrl:url,status}",
        ");return;}if(/\\.wasm($|\\?)/i.test(url)&&contentType&&!/wasm/i.test(contentType)){emit('resou",
        "rce-mime-mismatch','error','code-server asset used an unexpected MIME type',{contentType,res",
        "ourceUrl:url,status});return;}if(/\\.(js|mjs)($|\\?)/i.test(url)&&contentType&&!/(javascript|e",
        "cmascript|module|text\\/plain)/i.test(contentType)){emit('resource-mime-mismatch','error','co",
        "de-server script used an unexpected MIME type',{contentType,resourceUrl:url,status});}}",
    ]),
  ].join("");
}

function transportSection(): string {
  return [
    "function flushTransport(){if(!state.buffer.length)return;const batch=state.buffer.splice(0,state.buffer.length);",
    joinChunks([
        "if(transport.mode==='memory'){const key=transport.arrayName||'__CODE_SERVER_KIT_BROWSER_EVEN",
        "TS__';window[key]=Array.isArray(window[key])?window[key]:[];window[key].push.apply(window[ke",
        "y],batch);return;}",
    ]),
    joinChunks([
        "if(transport.mode==='callback'){const callback=transport.callbackName&&window[transport.call",
        "backName];if(typeof callback==='function')callback(batch);return;}",
    ]),
    joinChunks([
        "if(transport.mode==='postmessage'){try{const target=inIframe?window.parent:window;target.pos",
        "tMessage({events:batch,type:transport.messageType},transport.targetOrigin||'*');}catch{}retu",
        "rn;}",
    ]),
    joinChunks([
        "if(transport.mode==='http-post'&&transport.endpointUrl){const body=JSON.stringify({events:ba",
        "tch,type:transport.messageType});const headers=transport.headers||{'content-type':'applicati",
        "on/json'};if(transport.preferSendBeacon&&navigator.sendBeacon){try{navigator.sendBeacon(tran",
        "sport.endpointUrl,new Blob([body],{type:headers['content-type']||'application/json'}));retur",
        "n;}catch{}}if(window.fetch){fetch(transport.endpointUrl,{body,headers,keepalive:!!transport.",
        "keepalive,method:'POST'}).catch(function(){state.buffer.unshift.apply(state.buffer,batch);})",
        ";}}}",
    ]),
    joinChunks([
        "function scheduleFlush(){if(state.buffer.length>=(transport.batchSize||20)){flushTransport()",
        ";return;}if(state.flushTimer)return;state.flushTimer=window.setTimeout(function(){state.flus",
        "hTimer=null;flushTransport();},transport.debounceMs||250);}",
    ]),
  ].join("");
}

function fetchSection(): string {
  return [
    joinChunks([
        "function installFetchDiagnostics(){if(typeof window.fetch!=='function')return;const nativeFe",
        "tch=window.fetch.bind(window);window.fetch=function(input,init){const requestUrl=typeof inpu",
        "t==='string'?input:input&&input.url?input.url:null;return nativeFetch(input,init).then(funct",
        "ion(response){recordAssetResponse(response.url||requestUrl,response.status,response.headers&",
        "&response.headers.get?response.headers.get('content-type'):null);return response;}).catch(fu",
        "nction(error){emit('resource-error','error','browser fetch request failed',{message:String(e",
        "rror&&error.message||error),resourceUrl:requestUrl});throw error;});};}",
    ]),
  ].join("");
}

function windowEventsSection(): string {
  return [
    joinChunks([
        "function installWindowDiagnostics(){emit('bootstrap-started','info','browser diagnostics boo",
        "tstrap started',{sessionKey});window.addEventListener('error',function(event){const target=e",
        "vent.target;if(target&&target!==window){emit('resource-error','error','browser resource fail",
        "ed to load',{href:target.href||null,resourceUrl:target.src||target.href||null,tagName:target",
        ".tagName||null});return;}emit('javascript-error','error',String(event.message||'browser runt",
        "ime error'),{column:event.colno||null,filename:event.filename||null,line:event.lineno||null}",
        ");},true);window.addEventListener('unhandledrejection',function(event){emit('unhandled-rejec",
        "tion','error','browser promise rejection',{reason:String(event.reason&&event.reason.message|",
        "|event.reason||'unknown')});});document.addEventListener('securitypolicyviolation',function(",
        "event){emit('csp-violation','error','browser content security policy violation',{blockedURI:",
        "event.blockedURI||null,effectiveDirective:event.effectiveDirective||null});});}",
    ]),
    joinChunks([
        "function installServiceWorkerDiagnostics(){if(!navigator.serviceWorker)return;navigator.serv",
        "iceWorker.addEventListener('controllerchange',function(){emit('service-worker-controller-cha",
        "nge','info','service worker controller changed',{});});navigator.serviceWorker.ready.then(fu",
        "nction(registration){emit('service-worker-ready','info','service worker ready',{scope:regist",
        "ration.scope||null});}).catch(function(error){emit('service-worker-error','warn','service wo",
        "rker readiness failed',{message:String(error&&error.message||error)});});}",
    ]),
  ].join("");
}

function workerAndWebSocketSection(): string {
  return [
    joinChunks([
        "function installWorkerDiagnostics(){if(typeof window.Worker!=='function')return;const Native",
        "Worker=window.Worker;window.Worker=function(url,options){emit('worker-created','info','worke",
        "r created',{resourceUrl:String(url)});try{const worker=new NativeWorker(url,options);worker.",
        "addEventListener('error',function(){state.workerFailed=true;emit('worker-error','error','wor",
        "ker reported an error',{resourceUrl:String(url)});});return worker;}catch(error){state.worke",
        "rFailed=true;emit('worker-error','error','worker construction failed',{message:String(error&",
        "&error.message||error),resourceUrl:String(url)});throw error;}};window.Worker.prototype=Nati",
        "veWorker.prototype;}",
    ]),
    joinChunks([
        "function installWebSocketDiagnostics(){if(typeof window.WebSocket!=='function')return;const ",
        "NativeWebSocket=window.WebSocket;function DiagnosticWebSocket(url,protocols){const socket=pr",
        "otocols===undefined?new NativeWebSocket(url):new NativeWebSocket(url,protocols);socket.addEv",
        "entListener('open',function(){state.websocketReady=true;emit('websocket-open','info','browse",
        "r websocket connected',{resourceUrl:String(url)});postEmbed('status',{eventType:'websocket-o",
        "pen',state:'loading'});});socket.addEventListener('error',function(){emit('websocket-error',",
        "'error','browser websocket error',{resourceUrl:String(url)});});socket.addEventListener('clo",
        "se',function(event){emit('websocket-close',event&&event.code===1000?'info':'warn','browser w",
        "ebsocket closed',{code:event&&event.code||null,resourceUrl:String(url),wasClean:event&&event",
        ".wasClean||false});});return socket;}DiagnosticWebSocket.prototype=NativeWebSocket.prototype",
        ";DiagnosticWebSocket.CONNECTING=NativeWebSocket.CONNECTING;DiagnosticWebSocket.OPEN=NativeWe",
        "bSocket.OPEN;DiagnosticWebSocket.CLOSING=NativeWebSocket.CLOSING;DiagnosticWebSocket.CLOSED=",
        "NativeWebSocket.CLOSED;window.WebSocket=DiagnosticWebSocket;}",
    ]),
  ].join("");
}

function iframeSection(): string {
  return [
    joinChunks([
        "function installIframeDiagnostics(){if(!inIframe)return;emit('iframe-loaded','info','iframe ",
        "integration detected',{visibilityState:document.visibilityState||null});postEmbed('status',{",
        "eventType:'iframe-loaded',state:'loading'});window.addEventListener('load',function(){emit('",
        "iframe-ready','info','iframe load event fired',{});});window.addEventListener('error',functi",
        "on(event){if(event.target===window)return;emit('iframe-error','warn','iframe resource load i",
        "ssue detected',{resourceUrl:event.target&&(event.target.src||event.target.href)||null});},tr",
        "ue);document.addEventListener('visibilitychange',function(){emit('iframe-visibility','info',",
        "'iframe visibility changed',{visibilityState:document.visibilityState||null,visible:document",
        ".visibilityState!=='hidden'});postEmbed('visibility',{visible:document.visibilityState!=='hi",
        "dden'});});window.setTimeout(function(){if(!state.workbenchMounted){emit('iframe-timeout','w",
        "arn','iframe remained in a loading state for too long',{timeoutMs:policy.iframeTimeoutMs});p",
        "ostEmbed('still-loading',{timeoutMs:policy.iframeTimeoutMs});}},policy.iframeTimeoutMs);}",
    ]),
  ].join("");
}

function themeSection(): string {
  return [
    joinChunks([
        "function applyTheme(nextTheme,source){if(!nextTheme)return;state.theme=nextTheme;document.do",
        "cumentElement.setAttribute(theme.attributeName,nextTheme);emit('theme-sync','info','theme sy",
        "nchronized',{source,theme:nextTheme});}",
    ]),
    joinChunks([
        "function themeBootstrap(){if(theme.initialTheme)applyTheme(theme.initialTheme,'initial');if(",
        "theme.storageKey){try{const stored=window.localStorage.getItem(theme.storageKey);if(stored)a",
        "pplyTheme(stored,'storage-initial');}catch{}window.addEventListener('storage',function(event",
        "){if(event.key===theme.storageKey&&event.newValue)applyTheme(event.newValue,'storage');});}i",
        "f(theme.broadcastChannelName&&window.BroadcastChannel){try{const channel=new BroadcastChanne",
        "l(theme.broadcastChannelName);channel.addEventListener('message',function(event){const next=",
        "event.data&&(event.data.theme||event.data.value||event.data);if(typeof next==='string')apply",
        "Theme(next,'broadcast-channel');});}catch{}}if(theme.eventName){window.addEventListener(them",
        "e.eventName,function(event){const next=event&&event.detail&&(event.detail.theme||event.detai",
        "l.value);if(typeof next==='string')applyTheme(next,'event');});}}",
    ]),
  ].join("");
}

function workbenchSection(): string {
  return [
    joinChunks([
        "function detectShellLoaded(){const matched=(policy.shellSelectors||[]).find(function(selecto",
        "r){try{return !!document.querySelector(selector);}catch{return false;}});emit('shell-loaded'",
        ",'info','browser shell loaded',{readyState:document.readyState,selector:matched||null});post",
        "Embed('status',{eventType:'shell-loaded',state:'loading'});}",
    ]),
    joinChunks([
        "function checkWorkbench(){if(state.workbenchMounted)return true;const selector=(policy.workb",
        "enchSelectors||[]).find(function(current){try{return !!document.querySelector(current);}catc",
        "h{return false;}});if(selector){state.workbenchMounted=true;emit('workbench-mounted','info',",
        "'browser workbench mounted',{selector});return true;}return false;}",
    ]),
    joinChunks([
        "function monitorWorkbench(){const bootstrapDeadline=Date.now()+policy.bootstrapTimeoutMs;con",
        "st stallDeadline=Date.now()+(policy.stallTimeoutMs||8000);const observer=window.MutationObse",
        "rver?new MutationObserver(function(){checkWorkbench();}):null;if(observer&&document.document",
        "Element)observer.observe(document.documentElement,{childList:true,subtree:true});function ti",
        "ck(){if(checkWorkbench()){if(observer)observer.disconnect();return;}if(state.websocketReady&",
        "&!state.workbenchMounted&&Date.now()>=stallDeadline){emit(state.workerFailed?'extension-host",
        "-stalled':'frontend-stalled','error',state.workerFailed?'extension host appears stalled afte",
        "r websocket readiness':'frontend stalled after websocket readiness',{timeoutMs:policy.stallT",
        "imeoutMs});if(observer)observer.disconnect();return;}if(Date.now()>=bootstrapDeadline){emit(",
        "'bootstrap-timeout','error','browser bootstrap timed out',{selectors:policy.workbenchSelecto",
        "rs,timeoutMs:policy.bootstrapTimeoutMs});if(observer)observer.disconnect();return;}window.se",
        "tTimeout(tick,150);}tick();}",
    ]),
  ].join("");
}

function normalizeThemeSyncOptions(options?: CodeServerThemeSyncOptions): Required<CodeServerThemeSyncOptions> {
  return {
    attributeName: options?.attributeName ?? "data-theme",
    broadcastChannelName: options?.broadcastChannelName ?? "package:code-server-theme",
    eventName: options?.eventName ?? "package:code-server-theme",
    initialTheme: options?.initialTheme ?? null,
    messageType: options?.messageType ?? "package:code-server-theme",
    storageKey: options?.storageKey ?? "package:code-server-theme",
  };
}

export { createBrowserDiagnosticsScript };
