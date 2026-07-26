import type {
  CodeServerBrowserDiagnosticEvent,
  CodeServerBrowserDiagnosticsRuntimeTransport,
  CodeServerBrowserReadinessPolicy,
} from "#3c8d8166992a";

const DEFAULT_BROWSER_POLICY: CodeServerBrowserReadinessPolicy = {
  bootstrapTimeoutMs: 20_000,
  iframeTimeoutMs: 15_000,
  shellSelectors: ["body", "#root", ".monaco-shell", ".monaco-workbench"],
  stallTimeoutMs: 8_000,
  target: "workbench",
  workbenchSelectors: [".monaco-workbench", ".workbench"],
};

const DEFAULT_TRANSPORT_RUNTIME: CodeServerBrowserDiagnosticsRuntimeTransport = {
  arrayName: "__CODE_SERVER_KIT_BROWSER_EVENTS__",
  batchSize: 20,
  callbackName: "__packageCodeServerBrowserDiagnostics__",
  debounceMs: 250,
  keepalive: true,
  messageType: "package:code-server-diagnostics",
  mode: "memory",
  preferSendBeacon: true,
  retryCount: 1,
  targetOrigin: "*",
};

const DEFAULT_EMBED_CHANNEL = "package:code-server-embed";

const KNOWN_BROWSER_TYPES = new Set<CodeServerBrowserDiagnosticEvent["type"]>([
  "asset-404",
  "asset-missing",
  "bootstrap-started",
  "bootstrap-timeout",
  "csp-violation",
  "custom",
  "extension-host-stalled",
  "frontend-stalled",
  "iframe-error",
  "iframe-failure",
  "iframe-loaded",
  "iframe-ready",
  "iframe-timeout",
  "iframe-visibility",
  "javascript-error",
  "readonly-guard",
  "resource-error",
  "resource-mime-mismatch",
  "service-worker",
  "service-worker-controller-change",
  "service-worker-error",
  "service-worker-ready",
  "shell-loaded",
  "theme-sync",
  "unhandled-rejection",
  "websocket-close",
  "websocket-error",
  "websocket-open",
  "worker-created",
  "worker-error",
  "workbench-mounted",
]);

export {
  DEFAULT_BROWSER_POLICY,
  DEFAULT_EMBED_CHANNEL,
  DEFAULT_TRANSPORT_RUNTIME,
  KNOWN_BROWSER_TYPES,
};
