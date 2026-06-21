import { createReadonlyBrowserPolicy } from "#3nojkzzzf31b";
import { classifyCodeServerBrowserFailure, summarizeCodeServerBrowserDiagnostics } from "./classification.js";
import { createSessionDiagnosticsBridge } from "./bridge.js";
import { parseBrowserDiagnosticEvent } from "./shared.js";
import { createBrowserDiagnosticsScript } from "./script.js";
import { normalizeTransport } from "./transport.js";
import { transformCodeServerHtml } from "./html.js";
import type {
  CodeServerBrowserBridge,
  CodeServerBrowserBridgeOptions,
  CodeServerBrowserIntegration,
  CodeServerBrowserIntegrationOptions,
  TransformCodeServerHtmlOptions,
} from "#gk2pmrelxtj4";

function createCodeServerBrowserIntegration(
  options: CodeServerBrowserIntegrationOptions = {},
): CodeServerBrowserIntegration {
  return createCodeServerBrowserBridge(options);
}

function createCodeServerBrowserBridge(
  options: CodeServerBrowserBridgeOptions = {},
): CodeServerBrowserBridge {
  const bridge = options.bridge ?? createSessionDiagnosticsBridge({
    policy: options.diagnostics?.policy,
    sanitizer: options.diagnostics?.sanitizer,
  });
  const readonlyPolicy = createReadonlyBrowserPolicy(options.readonly);
  const transport = normalizeTransport(options.diagnostics?.transport);

  const base = {
    bridge,
    classifyFailure(events = bridge.getEvents()) {
      return classifyCodeServerBrowserFailure(events);
    },
    createScript(overrides: Partial<TransformCodeServerHtmlOptions> = {}) {
      return createBrowserDiagnosticsScript({
        bridgeProperty: options.diagnostics?.bridgeProperty,
        embed: overrides.embed ?? options.embed,
        policy: overrides.diagnostics?.policy ?? options.diagnostics?.policy,
        readonly: overrides.readonly ?? readonlyPolicy,
        sessionKey: overrides.sessionKey ?? options.sessionKey,
        theme: options.theme,
        transport: transport.getRuntimeConfig(),
      });
    },
    readonlyPolicy,
    summarize(events = bridge.getEvents()) {
      return summarizeCodeServerBrowserDiagnostics(events);
    },
    transformHtml(overrides) {
      return transformCodeServerHtml({
        appearance: overrides.appearance ?? options.appearance,
        bridge,
        cspNonce: overrides.cspNonce ?? options.html?.cspNonce,
        diagnostics: {
          ...options.diagnostics,
          transport,
        },
        embed: options.embed,
        html: overrides.html,
        injectStrategy: overrides.injectStrategy ?? options.html?.injectStrategy,
        readonly: readonlyPolicy,
        sessionKey: options.sessionKey,
        stripEmptyModuleScripts: overrides.stripEmptyModuleScripts ?? options.html?.stripEmptyModuleScripts,
        stripKnownBrokenModuleScripts: overrides.stripKnownBrokenModuleScripts ?? options.html?.stripKnownBrokenModuleScripts,
        theme: options.theme,
      });
    },
    transport,
  };

  return {
    ...base,
    injectHtml(options) {
      return base.transformHtml(options);
    },
    parseEvent(event, sanitizer) {
      return parseBrowserDiagnosticEvent(event, sanitizer);
    },
    parseMessage(data, sanitizer) {
      return transport.parseMessage(data, sanitizer);
    },
  };
}

export {
  createCodeServerBrowserBridge,
  createCodeServerBrowserIntegration,
};
