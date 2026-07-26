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
} from "#3c8d8166992a";

function createCodeServerBrowserIntegration(
  options: CodeServerBrowserIntegrationOptions = {},
): CodeServerBrowserIntegration {
  return createCodeServerBrowserBridge(options);
}

function createCodeServerBrowserBridge(
  options: CodeServerBrowserBridgeOptions = {},
): CodeServerBrowserBridge {
  const context = resolveBrowserBridgeContext(options);
  const base = createBaseBrowserIntegration(options, context);

  return {
    ...base,
    injectHtml(overrides) {
      return base.transformHtml(overrides);
    },
    parseEvent(event, sanitizer) {
      return parseBrowserDiagnosticEvent(event, sanitizer);
    },
    parseMessage(data, sanitizer) {
      return context.transport.parseMessage(data, sanitizer);
    },
  };
}

function resolveBrowserBridgeContext(options: CodeServerBrowserBridgeOptions) {
  const bridge = options.bridge ?? createSessionDiagnosticsBridge({
    policy: options.diagnostics?.policy,
    sanitizer: options.diagnostics?.sanitizer,
  });
  const readonlyPolicy = createReadonlyBrowserPolicy(options.readonly);
  const transport = normalizeTransport(options.diagnostics?.transport);
  return { bridge, readonlyPolicy, transport };
}

function createBaseBrowserIntegration(
  options: CodeServerBrowserBridgeOptions,
  context: ReturnType<typeof resolveBrowserBridgeContext>,
): CodeServerBrowserIntegration {
  return {
    bridge: context.bridge,
    classifyFailure(events = context.bridge.getEvents()) {
      return classifyCodeServerBrowserFailure(events);
    },
    createScript(overrides: Partial<TransformCodeServerHtmlOptions> = {}) {
      return createBrowserDiagnosticsScript({
        bridgeProperty: options.diagnostics?.bridgeProperty,
        embed: overrides.embed ?? options.embed,
        policy: overrides.diagnostics?.policy ?? options.diagnostics?.policy,
        readonly: overrides.readonly ?? context.readonlyPolicy,
        sessionKey: overrides.sessionKey ?? options.sessionKey,
        theme: options.theme,
        transport: context.transport.getRuntimeConfig(),
      });
    },
    readonlyPolicy: context.readonlyPolicy,
    summarize(events = context.bridge.getEvents()) {
      return summarizeCodeServerBrowserDiagnostics(events);
    },
    transformHtml(overrides) {
      return transformCodeServerHtml({
        appearance: overrides.appearance ?? options.appearance,
        bridge: context.bridge,
        cspNonce: overrides.cspNonce ?? options.html?.cspNonce,
        diagnostics: {
          ...options.diagnostics,
          transport: context.transport,
        },
        embed: options.embed,
        html: overrides.html,
        injectStrategy: overrides.injectStrategy ?? options.html?.injectStrategy,
        readonly: context.readonlyPolicy,
        sessionKey: options.sessionKey,
        stripEmptyModuleScripts: overrides.stripEmptyModuleScripts ?? options.html?.stripEmptyModuleScripts,
        stripKnownBrokenModuleScripts: overrides.stripKnownBrokenModuleScripts ?? options.html?.stripKnownBrokenModuleScripts,
        theme: options.theme,
      });
    },
    transport: context.transport,
  };
}

export {
  createCodeServerBrowserBridge,
  createCodeServerBrowserIntegration,
};
