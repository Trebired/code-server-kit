import type {
  CodeServerBrowserDiagnosticLevel,
  CodeServerBrowserDiagnosticsTransportMode,
  CodeServerBrowserDiagnosticType,
  CodeServerBrowserFailureCategory,
  CodeServerEmbedMessageType,
  CodeServerEmbedState,
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerLifecyclePhase,
  CodeServerReadinessTarget,
  CodeServerReadonlyBrowserActionSource,
} from "./core.js";
import type { CodeServerReadonlyBrowserActionKind } from "./core.js";
import type { CodeServerReadonlyInput, CodeServerReadonlyPolicy } from "./preparation.js";
import type { CodeServerSanitizerOptions } from "./diagnostics.js";

type CodeServerBrowserReadinessPolicy = {
  bootstrapTimeoutMs: number;
  iframeTimeoutMs?: number;
  shellSelectors?: string[];
  stallTimeoutMs?: number;
  target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench">;
  workbenchSelectors: string[];
};

type CodeServerBrowserDiagnosticEvent = {
  details: Record<string, unknown>;
  level: CodeServerBrowserDiagnosticLevel;
  phase: CodeServerLifecyclePhase;
  retryable: boolean;
  summary: string;
  timestamp: string;
  type: CodeServerBrowserDiagnosticType;
};

type CodeServerReadonlyBrowserAction = {
  attributeName?: string;
  commandId?: string;
  commandUri?: string;
  href?: string;
  kind: CodeServerReadonlyBrowserActionKind;
  label?: string;
  selector?: string;
  source?: CodeServerReadonlyBrowserActionSource;
  shortcut?: string;
};

type CodeServerReadonlyBrowserBlockResult = {
  action: CodeServerReadonlyBrowserAction;
  blocked: boolean;
  reason: string | null;
  summary: string;
};

type CodeServerBrowserDiagnosticsTransportOptions = {
  arrayName?: string;
  batchSize?: number;
  callbackName?: string;
  debounceMs?: number;
  endpointUrl?: string;
  headers?: Record<string, string>;
  keepalive?: boolean;
  messageType?: string;
  mode?: CodeServerBrowserDiagnosticsTransportMode;
  preferSendBeacon?: boolean;
  retryCount?: number;
  targetOrigin?: string;
};

type CodeServerBrowserDiagnosticsRuntimeTransport = {
  arrayName?: string;
  batchSize: number;
  callbackName?: string;
  debounceMs: number;
  endpointUrl?: string;
  headers?: Record<string, string>;
  keepalive: boolean;
  messageType: string;
  mode: CodeServerBrowserDiagnosticsTransportMode;
  preferSendBeacon: boolean;
  retryCount: number;
  targetOrigin: string;
};

type CodeServerBrowserDiagnosticsTransport = {
  clear(): void;
  deliver(events: CodeServerBrowserDiagnosticEvent | CodeServerBrowserDiagnosticEvent[]): Promise<void>;
  getBufferedEvents(): CodeServerBrowserDiagnosticEvent[];
  getRuntimeConfig(): CodeServerBrowserDiagnosticsRuntimeTransport;
  mode: CodeServerBrowserDiagnosticsTransportMode;
  parseMessage(data: unknown, sanitizer?: CodeServerSanitizerOptions): CodeServerBrowserDiagnosticEvent[];
};

type CodeServerBrowserDiagnosticsScriptOptions = {
  bridgeProperty?: string;
  embed?: {
    channel?: string;
    enableParentStatus?: boolean;
  };
  nonce?: string;
  policy?: Partial<CodeServerBrowserReadinessPolicy>;
  readonly?: CodeServerReadonlyInput;
  sessionKey?: string;
  theme?: CodeServerThemeSyncOptions;
  transport?: CodeServerBrowserDiagnosticsRuntimeTransport | CodeServerBrowserDiagnosticsTransportOptions;
};

type CodeServerHtmlInjectionStrategy = "append-body" | "prepend-head";

type CodeServerHtmlInjectionPlan = {
  apply(html: string): string;
  markers: string[];
  script: string;
  snippet: string;
  strategy: CodeServerHtmlInjectionStrategy;
};

type CreateHtmlInjectionPlanOptions = {
  nonce?: string;
  script: string;
  strategy?: CodeServerHtmlInjectionStrategy;
};

type CodeServerThemeSyncOptions = {
  attributeName?: string;
  broadcastChannelName?: string;
  eventName?: string;
  initialTheme?: string | null;
  messageType?: string;
  storageKey?: string;
};

type CodeServerHtmlAppearanceOptions = {
  bodyData?: Record<string, string>;
  colorScheme?: string | null;
  faviconHref?: string | null;
  stylesheetHref?: string | null;
  title?: string | null;
};

type CodeServerBrowserFailure = {
  category: CodeServerBrowserFailureCategory;
  hint: string;
  relevantEvent: CodeServerBrowserDiagnosticEvent | null;
  retryable: boolean;
  summary: string;
};

type CodeServerBrowserDiagnosticsSummary = {
  counts: Record<string, number>;
  eventCategory: CodeServerBrowserDiagnosticType | "none";
  failureHint: string | null;
  frameState: "failed" | "hidden" | "loading" | "ready" | "unknown";
  mostRelevantUrl: string | null;
  retryable: boolean;
  selectors: string[];
  workbenchState: "loading" | "mounted" | "stalled" | "unknown";
};

type CodeServerBrowserIntegrationOptions = {
  appearance?: CodeServerHtmlAppearanceOptions;
  bridge?: CodeServerSessionDiagnosticsBridge;
  diagnostics?: {
    bridgeProperty?: string;
    policy?: Partial<CodeServerBrowserReadinessPolicy>;
    sanitizer?: CodeServerSanitizerOptions;
    transport?: CodeServerBrowserDiagnosticsTransport | CodeServerBrowserDiagnosticsTransportOptions;
  };
  embed?: {
    channel?: string;
    enableParentStatus?: boolean;
  };
  html?: {
    cspNonce?: string;
    injectStrategy?: CodeServerHtmlInjectionStrategy;
    stripEmptyModuleScripts?: boolean;
    stripKnownBrokenModuleScripts?: boolean;
  };
  readonly?: CodeServerReadonlyInput;
  sessionKey?: string;
  theme?: CodeServerThemeSyncOptions;
};

type CodeServerBrowserBridgeOptions = CodeServerBrowserIntegrationOptions;

type TransformCodeServerHtmlOptions = {
  appearance?: CodeServerHtmlAppearanceOptions;
  bridge?: CodeServerSessionDiagnosticsBridge;
  cspNonce?: string;
  diagnostics?: CodeServerBrowserIntegrationOptions["diagnostics"];
  embed?: CodeServerBrowserIntegrationOptions["embed"];
  html: string;
  injectStrategy?: CodeServerHtmlInjectionStrategy;
  readonly?: CodeServerReadonlyInput;
  sessionKey?: string;
  stripEmptyModuleScripts?: boolean;
  stripKnownBrokenModuleScripts?: boolean;
  theme?: CodeServerThemeSyncOptions;
};

type CodeServerBrowserIntegration = {
  bridge: CodeServerSessionDiagnosticsBridge;
  classifyFailure(events?: CodeServerBrowserDiagnosticEvent[]): CodeServerBrowserFailure;
  createScript(options?: Partial<TransformCodeServerHtmlOptions>): string;
  readonlyPolicy: CodeServerReadonlyPolicy;
  summarize(events?: CodeServerBrowserDiagnosticEvent[]): CodeServerBrowserDiagnosticsSummary;
  transformHtml(options: Omit<TransformCodeServerHtmlOptions, "bridge" | "diagnostics" | "readonly" | "theme" | "sessionKey"> & {
    cspNonce?: string;
  }): string;
  transport: CodeServerBrowserDiagnosticsTransport;
};

type CodeServerBrowserBridge = CodeServerBrowserIntegration & {
  injectHtml(options: Omit<TransformCodeServerHtmlOptions, "bridge" | "diagnostics" | "readonly" | "theme" | "sessionKey"> & {
    cspNonce?: string;
  }): string;
  parseEvent(event: unknown, sanitizer?: CodeServerSanitizerOptions): CodeServerBrowserDiagnosticEvent;
  parseMessage(data: unknown, sanitizer?: CodeServerSanitizerOptions): CodeServerBrowserDiagnosticEvent[];
};

type CodeServerEmbedMessage = {
  channel: string;
  payload: Record<string, unknown>;
  timestamp: string;
  type: CodeServerEmbedMessageType;
};

type CodeServerEmbedControllerOptions = {
  channel?: string;
  loadTimeoutMs?: number;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  sanitizer?: CodeServerSanitizerOptions;
  targetOrigin?: string;
};

type CodeServerEmbedController = {
  createChildTransport(): CodeServerBrowserDiagnosticsTransport;
  createStatusMessage(type: CodeServerEmbedMessageType, payload?: Record<string, unknown>): CodeServerEmbedMessage;
  getState(): {
    events: CodeServerEmbedMessage[];
    lastMessage: CodeServerEmbedMessage | null;
    ready: boolean;
    state: CodeServerEmbedState;
    targetOrigin: string;
    visible: boolean;
  };
  handleMessage(data: unknown): CodeServerEmbedMessage | null;
  recordVisibility(visible: boolean): CodeServerEmbedMessage;
  waitForReady(options?: {
    timeoutMs?: number;
  }): Promise<CodeServerEmbedMessage>;
};

type CodeServerSessionDiagnosticsBridge = {
  getEvents(): CodeServerBrowserDiagnosticEvent[];
  getSnapshot(): {
    events: CodeServerBrowserDiagnosticEvent[];
    latestEvent: CodeServerBrowserDiagnosticEvent | null;
    readyTargets: CodeServerReadinessTarget[];
  };
  recordEvent(event: unknown): CodeServerBrowserDiagnosticEvent;
  waitForTarget(target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">, options?: {
    timeoutMs?: number;
  }): Promise<{
    elapsedMs: number;
    event: CodeServerBrowserDiagnosticEvent;
    target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">;
  }>;
};

type CreateCodeServerSessionDiagnosticsBridgeOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  policy?: Partial<CodeServerBrowserReadinessPolicy>;
  sanitizer?: CodeServerSanitizerOptions;
};

type CodeServerSessionBrowserOptions = {
  bridge?: CodeServerSessionDiagnosticsBridge;
  integration?: CodeServerBrowserBridge;
  policy?: Partial<CodeServerBrowserReadinessPolicy>;
};

export type {
  CodeServerBrowserBridge,
  CodeServerBrowserBridgeOptions,
  CodeServerBrowserDiagnosticEvent,
  CodeServerBrowserDiagnosticsRuntimeTransport,
  CodeServerBrowserDiagnosticsScriptOptions,
  CodeServerBrowserDiagnosticsSummary,
  CodeServerBrowserDiagnosticsTransport,
  CodeServerBrowserDiagnosticsTransportOptions,
  CodeServerBrowserFailure,
  CodeServerBrowserIntegration,
  CodeServerBrowserIntegrationOptions,
  CodeServerBrowserReadinessPolicy,
  CodeServerEmbedController,
  CodeServerEmbedControllerOptions,
  CodeServerEmbedMessage,
  CodeServerHtmlAppearanceOptions,
  CodeServerHtmlInjectionPlan,
  CodeServerHtmlInjectionStrategy,
  CodeServerReadonlyBrowserAction,
  CodeServerReadonlyBrowserBlockResult,
  CodeServerSessionBrowserOptions,
  CodeServerSessionDiagnosticsBridge,
  CodeServerThemeSyncOptions,
  CreateCodeServerSessionDiagnosticsBridgeOptions,
  CreateHtmlInjectionPlanOptions,
  TransformCodeServerHtmlOptions,
};
