import { DEFAULT_EMBED_CHANNEL } from "./constants.js";
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
    "function postEmbed(type,payload){if(!inIframe||!embed.enableParentStatus)return;try{window.parent.postMessage({channel:embed.channel,payload:payload||{},timestamp:now(),type},transport.targetOrigin||'*');}catch{}}",
    "function bridgeEmit(payload){try{const bridge=window[bridgeProperty];if(typeof bridge==='function')bridge(payload);if(bridge&&typeof bridge.recordEvent==='function')bridge.recordEvent(payload);}catch(error){console.warn('code-server-kit diagnostics bridge failed',error);}}",
    "function emit(type,level,summary,details){const payload={details:details||{},level:level||'info',summary,timestamp:now(),type};bridgeEmit(payload);state.buffer.push(payload);scheduleFlush();if(type==='workbench-mounted')postEmbed('ready',{event:payload,state:'ready'});if(type==='bootstrap-timeout'||level==='error'||type==='iframe-failure'||type==='iframe-timeout')postEmbed('failure',{event:payload,state:'failed'});}",
    "function emitReadonlyBlocked(kind,details){emit('readonly-guard','warn','readonly browser policy blocked an action',Object.assign({kind,message:readonlyPolicy.browserGuards.readonlyMessage},details||{}));}",
    "function recordAssetResponse(url,status,contentType){if(!isAssetUrl(url))return;if(status===404){emit('asset-404','error','code-server asset returned 404',{resourceUrl:url,status});emit('asset-missing','error','code-server asset appears to be missing',{resourceUrl:url,status});return;}if(/\\.wasm($|\\?)/i.test(url)&&contentType&&!/wasm/i.test(contentType)){emit('resource-mime-mismatch','error','code-server asset used an unexpected MIME type',{contentType,resourceUrl:url,status});return;}if(/\\.(js|mjs)($|\\?)/i.test(url)&&contentType&&!/(javascript|ecmascript|module|text\\/plain)/i.test(contentType)){emit('resource-mime-mismatch','error','code-server script used an unexpected MIME type',{contentType,resourceUrl:url,status});}}",
  ].join("");
}

function transportSection(): string {
  return [
    "function flushTransport(){if(!state.buffer.length)return;const batch=state.buffer.splice(0,state.buffer.length);",
    "if(transport.mode==='memory'){const key=transport.arrayName||'__CODE_SERVER_KIT_BROWSER_EVENTS__';window[key]=Array.isArray(window[key])?window[key]:[];window[key].push.apply(window[key],batch);return;}",
    "if(transport.mode==='callback'){const callback=transport.callbackName&&window[transport.callbackName];if(typeof callback==='function')callback(batch);return;}",
    "if(transport.mode==='postmessage'){try{const target=inIframe?window.parent:window;target.postMessage({events:batch,type:transport.messageType},transport.targetOrigin||'*');}catch{}return;}",
    "if(transport.mode==='http-post'&&transport.endpointUrl){const body=JSON.stringify({events:batch,type:transport.messageType});const headers=transport.headers||{'content-type':'application/json'};if(transport.preferSendBeacon&&navigator.sendBeacon){try{navigator.sendBeacon(transport.endpointUrl,new Blob([body],{type:headers['content-type']||'application/json'}));return;}catch{}}if(window.fetch){fetch(transport.endpointUrl,{body,headers,keepalive:!!transport.keepalive,method:'POST'}).catch(function(){state.buffer.unshift.apply(state.buffer,batch);});}}}",
    "function scheduleFlush(){if(state.buffer.length>=(transport.batchSize||20)){flushTransport();return;}if(state.flushTimer)return;state.flushTimer=window.setTimeout(function(){state.flushTimer=null;flushTransport();},transport.debounceMs||250);}",
  ].join("");
}

function fetchSection(): string {
  return [
    "function installFetchDiagnostics(){if(typeof window.fetch!=='function')return;const nativeFetch=window.fetch.bind(window);window.fetch=function(input,init){const requestUrl=typeof input==='string'?input:input&&input.url?input.url:null;return nativeFetch(input,init).then(function(response){recordAssetResponse(response.url||requestUrl,response.status,response.headers&&response.headers.get?response.headers.get('content-type'):null);return response;}).catch(function(error){emit('resource-error','error','browser fetch request failed',{message:String(error&&error.message||error),resourceUrl:requestUrl});throw error;});};}",
  ].join("");
}

function windowEventsSection(): string {
  return [
    "function installWindowDiagnostics(){emit('bootstrap-started','info','browser diagnostics bootstrap started',{sessionKey});window.addEventListener('error',function(event){const target=event.target;if(target&&target!==window){emit('resource-error','error','browser resource failed to load',{href:target.href||null,resourceUrl:target.src||target.href||null,tagName:target.tagName||null});return;}emit('javascript-error','error',String(event.message||'browser runtime error'),{column:event.colno||null,filename:event.filename||null,line:event.lineno||null});},true);window.addEventListener('unhandledrejection',function(event){emit('unhandled-rejection','error','browser promise rejection',{reason:String(event.reason&&event.reason.message||event.reason||'unknown')});});document.addEventListener('securitypolicyviolation',function(event){emit('csp-violation','error','browser content security policy violation',{blockedURI:event.blockedURI||null,effectiveDirective:event.effectiveDirective||null});});}",
    "function installServiceWorkerDiagnostics(){if(!navigator.serviceWorker)return;navigator.serviceWorker.addEventListener('controllerchange',function(){emit('service-worker-controller-change','info','service worker controller changed',{});});navigator.serviceWorker.ready.then(function(registration){emit('service-worker-ready','info','service worker ready',{scope:registration.scope||null});}).catch(function(error){emit('service-worker-error','warn','service worker readiness failed',{message:String(error&&error.message||error)});});}",
  ].join("");
}

function workerAndWebSocketSection(): string {
  return [
    "function installWorkerDiagnostics(){if(typeof window.Worker!=='function')return;const NativeWorker=window.Worker;window.Worker=function(url,options){emit('worker-created','info','worker created',{resourceUrl:String(url)});try{const worker=new NativeWorker(url,options);worker.addEventListener('error',function(){state.workerFailed=true;emit('worker-error','error','worker reported an error',{resourceUrl:String(url)});});return worker;}catch(error){state.workerFailed=true;emit('worker-error','error','worker construction failed',{message:String(error&&error.message||error),resourceUrl:String(url)});throw error;}};window.Worker.prototype=NativeWorker.prototype;}",
    "function installWebSocketDiagnostics(){if(typeof window.WebSocket!=='function')return;const NativeWebSocket=window.WebSocket;function DiagnosticWebSocket(url,protocols){const socket=protocols===undefined?new NativeWebSocket(url):new NativeWebSocket(url,protocols);socket.addEventListener('open',function(){state.websocketReady=true;emit('websocket-open','info','browser websocket connected',{resourceUrl:String(url)});postEmbed('status',{eventType:'websocket-open',state:'loading'});});socket.addEventListener('error',function(){emit('websocket-error','error','browser websocket error',{resourceUrl:String(url)});});socket.addEventListener('close',function(event){emit('websocket-close',event&&event.code===1000?'info':'warn','browser websocket closed',{code:event&&event.code||null,resourceUrl:String(url),wasClean:event&&event.wasClean||false});});return socket;}DiagnosticWebSocket.prototype=NativeWebSocket.prototype;DiagnosticWebSocket.CONNECTING=NativeWebSocket.CONNECTING;DiagnosticWebSocket.OPEN=NativeWebSocket.OPEN;DiagnosticWebSocket.CLOSING=NativeWebSocket.CLOSING;DiagnosticWebSocket.CLOSED=NativeWebSocket.CLOSED;window.WebSocket=DiagnosticWebSocket;}",
  ].join("");
}

function iframeSection(): string {
  return [
    "function installIframeDiagnostics(){if(!inIframe)return;emit('iframe-loaded','info','iframe integration detected',{visibilityState:document.visibilityState||null});postEmbed('status',{eventType:'iframe-loaded',state:'loading'});window.addEventListener('load',function(){emit('iframe-ready','info','iframe load event fired',{});});window.addEventListener('error',function(event){if(event.target===window)return;emit('iframe-error','warn','iframe resource load issue detected',{resourceUrl:event.target&&(event.target.src||event.target.href)||null});},true);document.addEventListener('visibilitychange',function(){emit('iframe-visibility','info','iframe visibility changed',{visibilityState:document.visibilityState||null,visible:document.visibilityState!=='hidden'});postEmbed('visibility',{visible:document.visibilityState!=='hidden'});});window.setTimeout(function(){if(!state.workbenchMounted){emit('iframe-timeout','warn','iframe remained in a loading state for too long',{timeoutMs:policy.iframeTimeoutMs});postEmbed('still-loading',{timeoutMs:policy.iframeTimeoutMs});}},policy.iframeTimeoutMs);}",
  ].join("");
}

function themeSection(): string {
  return [
    "function applyTheme(nextTheme,source){if(!nextTheme)return;state.theme=nextTheme;document.documentElement.setAttribute(theme.attributeName,nextTheme);emit('theme-sync','info','theme synchronized',{source,theme:nextTheme});}",
    "function themeBootstrap(){if(theme.initialTheme)applyTheme(theme.initialTheme,'initial');if(theme.storageKey){try{const stored=window.localStorage.getItem(theme.storageKey);if(stored)applyTheme(stored,'storage-initial');}catch{}window.addEventListener('storage',function(event){if(event.key===theme.storageKey&&event.newValue)applyTheme(event.newValue,'storage');});}if(theme.broadcastChannelName&&window.BroadcastChannel){try{const channel=new BroadcastChannel(theme.broadcastChannelName);channel.addEventListener('message',function(event){const next=event.data&&(event.data.theme||event.data.value||event.data);if(typeof next==='string')applyTheme(next,'broadcast-channel');});}catch{}}if(theme.eventName){window.addEventListener(theme.eventName,function(event){const next=event&&event.detail&&(event.detail.theme||event.detail.value);if(typeof next==='string')applyTheme(next,'event');});}}",
  ].join("");
}

function workbenchSection(): string {
  return [
    "function detectShellLoaded(){const matched=(policy.shellSelectors||[]).find(function(selector){try{return !!document.querySelector(selector);}catch{return false;}});emit('shell-loaded','info','browser shell loaded',{readyState:document.readyState,selector:matched||null});postEmbed('status',{eventType:'shell-loaded',state:'loading'});}",
    "function checkWorkbench(){if(state.workbenchMounted)return true;const selector=(policy.workbenchSelectors||[]).find(function(current){try{return !!document.querySelector(current);}catch{return false;}});if(selector){state.workbenchMounted=true;emit('workbench-mounted','info','browser workbench mounted',{selector});return true;}return false;}",
    "function monitorWorkbench(){const bootstrapDeadline=Date.now()+policy.bootstrapTimeoutMs;const stallDeadline=Date.now()+(policy.stallTimeoutMs||8000);const observer=window.MutationObserver?new MutationObserver(function(){checkWorkbench();}):null;if(observer&&document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});function tick(){if(checkWorkbench()){if(observer)observer.disconnect();return;}if(state.websocketReady&&!state.workbenchMounted&&Date.now()>=stallDeadline){emit(state.workerFailed?'extension-host-stalled':'frontend-stalled','error',state.workerFailed?'extension host appears stalled after websocket readiness':'frontend stalled after websocket readiness',{timeoutMs:policy.stallTimeoutMs});if(observer)observer.disconnect();return;}if(Date.now()>=bootstrapDeadline){emit('bootstrap-timeout','error','browser bootstrap timed out',{selectors:policy.workbenchSelectors,timeoutMs:policy.bootstrapTimeoutMs});if(observer)observer.disconnect();return;}window.setTimeout(tick,150);}tick();}",
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
