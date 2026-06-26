export { createCodeServerProxyAdapter } from "./proxy/runtime.js";
export {
  buildCodeServerWebSocketHeaders,
  buildForwardedHeaders,
  classifyCodeServerProxyFailure,
  isCodeServerHtmlResponse,
  normalizeTrustedOrigin,
} from "./proxy/shared.js";
