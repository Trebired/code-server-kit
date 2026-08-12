import { joinChunks } from "./chunks.js";

function readonlyRuntimeHelpersSection(): string {
  return [
    readonlyCommandParsingSection(),
    readonlyBlockingSection(),
    readonlyActionExtractionSection(),
    readonlyPatchSection(),
  ].join("");
}

function readonlyCommandParsingSection(): string {
  return [
    joinChunks([
        "function buildShortcut(event){const parts=[];if(event.ctrlKey)parts.push('ctrl');if(event.me",
        "taKey)parts.push('meta');if(event.altKey)parts.push('alt');if(event.shiftKey)parts.push('shi",
        "ft');parts.push(String(event.key||'').toLowerCase());return parts.join('+');}",
    ]),
    "function normalizeReadonlyText(value){return String(value||'').trim();}",
    joinChunks([
        "function normalizeReadonlyCommandId(value){const normalized=normalizeReadonlyText(value).toL",
        "owerCase();return normalized||null;}",
    ]),
    "function normalizeReadonlyCommandUri(value){const normalized=normalizeReadonlyText(value);return normalized||null;}",
    joinChunks([
        "function normalizeReadonlyShortcut(value){return normalizeReadonlyText(value).toLowerCase().",
        "split('command').join('meta').split('cmd').join('meta').split('control').join('ctrl').replac",
        "e(/\\s+/g,'')||null;}",
    ]),
    "function decodeReadonlyUriComponent(value){try{return decodeURIComponent(value);}catch{return value;}}",
    joinChunks([
        "function parseReadonlyCommandUri(value){const normalized=normalizeReadonlyCommandUri(value);",
        "if(!normalized)return null;const match=/^([a-z0-9+.-]+):(.*)$/i.exec(normalized);if(!match)r",
        "eturn null;const scheme=String(match[1]||'').toLowerCase();let commandId=null;if(scheme==='c",
        "ommand'){const rawCommand=String(match[2]||'').replace(/^\\/\\//,'').split('?')[0]||'';command",
        "Id=normalizeReadonlyCommandId(decodeReadonlyUriComponent(rawCommand));}return{commandId,sche",
        "me,value:normalized};}",
    ]),
  ].join("");
}

function readonlyBlockingSection(): string {
  return [
    joinChunks([
        "function isReadonlyBlockedCommandId(commandId){const normalized=normalizeReadonlyCommandId(c",
        "ommandId);if(!normalized)return null;if(readonlyPolicy.blockedCommandIds.some(function(entry",
        "){return String(entry).toLowerCase()===normalized;}))return 'command \"'+commandId+'\" is bloc",
        "ked';if(readonlyPolicy.blockedCommandPrefixes.some(function(entry){return normalized.indexOf",
        "(String(entry).toLowerCase())===0;}))return 'command \"'+commandId+'\" matches a blocked prefi",
        "x';if(readonlyPolicy.blockedCommandSubstrings.some(function(entry){return normalized.indexOf",
        "(String(entry).toLowerCase())>=0;}))return 'command \"'+commandId+'\" matches a blocked patter",
        "n';return null;}",
    ]),
    joinChunks([
        "function isReadonlyBlockedSelector(selector){const normalized=normalizeReadonlyText(selector",
        ").toLowerCase();if(!normalized)return null;const match=readonlyPolicy.browserGuards.blockedS",
        "electors.find(function(entry){return normalized.indexOf(String(entry).toLowerCase())>=0;});r",
        "eturn match?'selector \"'+selector+'\" matches a blocked UI target':null;}",
    ]),
    joinChunks([
        "function isReadonlyBlockedLabel(label){const normalized=normalizeReadonlyText(label).toLower",
        "Case();if(!normalized)return null;const match=readonlyPolicy.browserGuards.blockedUiLabels.f",
        "ind(function(entry){return normalized.indexOf(String(entry).toLowerCase())>=0;});return matc",
        "h?'label \"'+label+'\" matches a blocked UI label':null;}",
    ]),
    joinChunks([
        "function resolveReadonlyActionReason(action){if(!readonlyPolicy.enabled)return null;if(actio",
        "n.kind==='beforeinput'&&readonlyPolicy.browserGuards.blockBeforeInput)return 'editor input m",
        "utations are disabled in readonly sessions';if(action.kind==='drop'&&readonlyPolicy.browserG",
        "uards.blockDragAndDrop)return 'drag-and-drop is disabled in readonly sessions';if(action.kin",
        "d==='paste'&&readonlyPolicy.browserGuards.blockPaste)return 'paste is disabled in readonly s",
        "essions';if(action.kind==='upload'&&readonlyPolicy.browserGuards.blockUpload)return 'uploads",
        " are disabled in readonly sessions';const parsed=parseReadonlyCommandUri(action.commandUri||",
        "action.href);if(parsed&&readonlyPolicy.browserGuards.blockedCommandLinkSchemes.some(function",
        "(entry){return String(entry).toLowerCase()===parsed.scheme;})){const commandReason=parsed.co",
        "mmandId?isReadonlyBlockedCommandId(parsed.commandId):null;if(commandReason)return 'command U",
        "RI \"'+parsed.value+'\" '+commandReason.replace(/^command /,'activates command ');if(readonlyP",
        "olicy.browserGuards.blockCommandLinks)return parsed.commandId?'command URI \"'+parsed.value+'",
        "\" is blocked':'command link scheme \"'+parsed.scheme+':\" is blocked';}const commandReason=isR",
        "eadonlyBlockedCommandId(action.commandId);if(commandReason)return commandReason;const shortc",
        "ut=normalizeReadonlyShortcut(action.shortcut);if(shortcut&&readonlyPolicy.blockedShortcuts.s",
        "ome(function(entry){return normalizeReadonlyShortcut(entry)===shortcut;}))return 'shortcut \"",
        "'+action.shortcut+'\" is blocked';const selectorReason=isReadonlyBlockedSelector(action.selec",
        "tor);if(selectorReason)return selectorReason;const labelReason=isReadonlyBlockedLabel(action",
        ".label);if(labelReason)return labelReason;return null;}",
    ]),
  ].join("");
}

function readonlyActionExtractionSection(): string {
  return [
    joinChunks([
        "function describeReadonlySource(target){if(!target||!target.closest)return 'unknown';if(targ",
        "et.closest('.notification-toast,.notification-list-item,.notifications-toasts'))return 'noti",
        "fication';if(target.closest('.monaco-menu,.context-view'))return 'context-menu';if(target.cl",
        "osest('.monaco-action-bar,.monaco-button,.editor-widget,.zone-widget'))return 'widget';if(ta",
        "rget.closest('.quick-input-widget,.quick-input-list'))return 'command-palette';if(target.clo",
        "sest('#__package_code_server_readonly_banner__'))return 'banner';if(target.closest('a,[href]",
        ",[data-href]'))return 'link';return 'unknown';}",
    ]),
    joinChunks([
        "function describeReadonlySelector(target){if(!target||!target.tagName)return null;const tag=",
        "String(target.tagName||'').toLowerCase();if(target.id)return tag+'#'+target.id;const classNa",
        "me=typeof target.className==='string'?target.className.trim().split(/\\s+/).filter(Boolean).s",
        "lice(0,3).join('.'):'';return className?tag+'.'+className:tag;}",
    ]),
    joinChunks([
        "function extractReadonlyAction(target,defaults){const element=target&&target.closest?target.",
        "closest('[data-command],[href],[data-href],button,[role=\"button\"],input,textarea,*'):target;",
        "if(!element)return Object.assign({kind:'selector',source:'unknown'},defaults||{});const href",
        "=element.getAttribute&&((element.getAttribute('href')||element.getAttribute('data-href'))||n",
        "ull);const commandId=element.getAttribute&&(element.getAttribute('data-command')||element.ge",
        "tAttribute('command'))||null;const label=normalizeReadonlyText(element.getAttribute&&(elemen",
        "t.getAttribute('aria-label')||element.getAttribute('title'))||(element.textContent||''))||nu",
        "ll;const action={attributeName:commandId?'data-command':href?(String(href).indexOf('command:",
        "')===0?'href':'data-href'):null,commandId:commandId||null,commandUri:href&&String(href).inde",
        "xOf('command:')===0?href:null,href:href||null,kind:(defaults&&defaults.kind)||'selector',lab",
        "el,selector:describeReadonlySelector(element),source:describeReadonlySource(element),shortcu",
        "t:(defaults&&defaults.shortcut)||null};return Object.assign(action,defaults||{});}",
    ]),
    joinChunks([
        "function blockReadonlyEvent(event,action){const reason=resolveReadonlyActionReason(action);i",
        "f(!reason)return false;event.preventDefault();event.stopPropagation();if(typeof event.stopIm",
        "mediatePropagation==='function')event.stopImmediatePropagation();emitReadonlyBlocked(action.",
        "kind,Object.assign({reason},action));return true;}",
    ]),
  ].join("");
}

function readonlyPatchSection(): string {
  return [
    joinChunks([
        "function patchReadonlyLinkClicks(){if(typeof HTMLAnchorElement!=='function'||typeof HTMLAnch",
        "orElement.prototype.click!=='function')return;const nativeClick=HTMLAnchorElement.prototype.",
        "click;HTMLAnchorElement.prototype.click=function(){const action=extractReadonlyAction(this,{",
        "kind:'command-uri',source:'link'});const reason=resolveReadonlyActionReason(action);if(reaso",
        "n){emitReadonlyBlocked(action.kind,Object.assign({reason},action));return;}return nativeClic",
        "k.call(this);};}",
    ]),
    joinChunks([
        "function patchReadonlyWindowOpen(){if(typeof window.open!=='function')return;const nativeOpe",
        "n=window.open.bind(window);window.open=function(url,target,features){const action={commandUr",
        "i:typeof url==='string'?url:null,href:typeof url==='string'?url:null,kind:'command-uri',labe",
        "l:null,selector:null,source:'link'};const reason=resolveReadonlyActionReason(action);if(reas",
        "on){emitReadonlyBlocked(action.kind,Object.assign({reason},action));return null;}return nati",
        "veOpen(url,target,features);};}",
    ]),
  ].join("");
}

function readonlyInstallSection(): string {
  return [
    readonlyInstallBannerSection(),
    readonlyInstallInputGuardSection(),
    readonlyInstallClickGuardSection(),
  ].join("");
}

function readonlyInstallBannerSection(): string {
  return [
    joinChunks([
        "function installReadonlyGuards(){if(!readonlyPolicy.enabled)return;window.__CODE_SERVER_KIT_",
        "READONLY_POLICY__=readonlyPolicy;",
    ]),
    "patchReadonlyLinkClicks();",
    "patchReadonlyWindowOpen();",
    joinChunks([
        "if(readonlyPolicy.browserGuards.showBanner){const renderBanner=function(){if(document.getEle",
        "mentById('__package_code_server_readonly_banner__'))return;const banner=document.createEleme",
        "nt('div');banner.id='__package_code_server_readonly_banner__';banner.textContent=readonlyPol",
        "icy.browserGuards.readonlyMessage;banner.setAttribute('role','status');banner.style.cssText=",
        "'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:6px 12px;background:#111827;",
        "color:#f9fafb;font:12px/1.4 sans-serif;text-align:center;pointer-events:none;opacity:.92';do",
        "cument.body.appendChild(banner);};if(document.readyState==='loading')document.addEventListen",
        "er('DOMContentLoaded',renderBanner,{once:true});else renderBanner();}",
    ]),
  ].join("");
}

function readonlyInstallInputGuardSection(): string {
  return [
    joinChunks([
        "window.addEventListener('keydown',function(event){const shortcut=buildShortcut(event);if(rea",
        "donlyPolicy.blockedShortcuts.indexOf(shortcut)>=0){event.preventDefault();event.stopPropagat",
        "ion();if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation()",
        ";emitReadonlyBlocked('shortcut',{reason:'shortcut \"'+shortcut+'\" is blocked',shortcut,source",
        ":'keyboard'});return;}if(event.key==='Enter'||event.key===' '){const action=extractReadonlyA",
        "ction(event.target,{kind:'command'});blockReadonlyEvent(event,action);}},true);",
    ]),
    joinChunks([
        "if(readonlyPolicy.browserGuards.blockDragAndDrop){const blockDrop=function(event){blockReado",
        "nlyEvent(event,{kind:'drop',source:'widget'});};window.addEventListener('dragover',blockDrop",
        ",true);window.addEventListener('drop',blockDrop,true);}",
    ]),
    joinChunks([
        "if(readonlyPolicy.browserGuards.blockPaste){window.addEventListener('paste',function(event){",
        "blockReadonlyEvent(event,{kind:'paste',source:'widget'});},true);}",
    ]),
    joinChunks([
        "if(readonlyPolicy.browserGuards.blockBeforeInput){window.addEventListener('beforeinput',func",
        "tion(event){const inputType=String(event&&event.inputType||'');if(!inputType||/^insert|^dele",
        "te|^history/i.test(inputType)){blockReadonlyEvent(event,{kind:'beforeinput',label:inputType|",
        "|null,source:'widget'});}},true);}",
    ]),
    joinChunks([
        "if(readonlyPolicy.browserGuards.blockUpload){window.addEventListener('change',function(event",
        "){const target=event.target;if(target&&target.matches&&target.matches(\"input[type='file']\"))",
        "{target.value='';blockReadonlyEvent(event,{kind:'upload',selector:\"input[type='file']\",sourc",
        "e:'widget'});}},true);}",
    ]),
  ].join("");
}

function readonlyInstallClickGuardSection(): string {
  return [
    joinChunks([
        "const clickHandler=function(event){const action=extractReadonlyAction(event.target,{kind:'co",
        "mmand'});blockReadonlyEvent(event,action);};",
    ]),
    "window.addEventListener('auxclick',clickHandler,true);",
    "window.addEventListener('click',clickHandler,true);",
    joinChunks([
        "window.addEventListener('submit',function(event){const target=event.target;if(target&&target",
        ".querySelector&&target.querySelector(\"input[type='file']\")){blockReadonlyEvent(event,{kind:'",
        "upload',selector:'form',source:'widget'});}},true);",
    ]),
    "}",
  ].join("");
}

export {
  readonlyInstallSection,
  readonlyRuntimeHelpersSection,
};
