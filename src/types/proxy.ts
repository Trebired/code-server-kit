import type {
  CodeServerBrowserBridge,
  CodeServerBrowserBridgeOptions,
  TransformCodeServerHtmlOptions,
} from "./browser.js";
import type { CodeServerSanitizerOptions } from "./diagnostics.js";
import type { CodeServerProfilePersistResult, CodeServerProfilePolicy } from "./profile.js";
import type { CodeServerReadonlyInput, CodeServerReadonlyPolicy } from "./preparation.js";

type BuildForwardedHeadersOptions = {
  forwardedFor?: string | string[];
  forwardedHost?: string;
  forwardedProto?: string;
  host?: string;
  port?: number | string;
  proto?: string;
};

type BuildCodeServerWebSocketHeadersOptions = BuildForwardedHeadersOptions& {
  connection?: string;
  upgrade?: string;
};

type CodeServerProxyFailureCategory = "refused" | "reset" | "timeout" | "upstream_failure" | "unknown";

type ClassifyCodeServerProxyFailureOptions = {
  error?: unknown;
  statusCode?: number | null;
};

type CodeServerProxyFailure = {
  category: CodeServerProxyFailureCategory;
  details: Record<string, unknown>;
  message: string;
};

type CodeServerProxyServiceWorkerMode = "neutralize" | "passthrough";
type CodeServerProxyResponseKind = "passthrough" | "service-worker-override" | "transform";
type CodeServerProfilePersistTrigger = "every-response" | "manual" | "transformed-html";

type CodeServerProxyResponseClassification = {
  kind: CodeServerProxyResponseKind;
  reason: string;
  stripBodyHeaders: boolean;
};

type CodeServerProxyServiceWorkerOverride = {
  body: string;
  contentType: string;
  headers: Record<string, string>;
  pathname: string;
  statusCode: number;
};

type CodeServerProxyAdapterOptions = {
  browser?: CodeServerBrowserBridge | CodeServerBrowserBridgeOptions;
  diagnostics?: {
    sanitizer?: CodeServerSanitizerOptions;
  };
  html?: Omit<TransformCodeServerHtmlOptions, "bridge"|"diagnostics"|"html"|"readonly"|"sessionKey"|"theme">;
  postResponse ? (result: CodeServerProxyResponseResult) : void |Promise<void>;
  profile?: CodeServerProfilePolicy;
  profilePersistTrigger?: CodeServerProfilePersistTrigger;
  profileRuntimeDir?: string;
  readonly?: CodeServerReadonlyInput;
  serviceWorker?: {
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
    mode?: CodeServerProxyServiceWorkerMode;
    pathname?: string;
    statusCode?: number;
  };
};

type CodeServerHtmlResponseOptions = {
  contentType?: string | null;
  headers?: Headers | Record<string, unknown>;
  method?: string;
  statusCode?: number;
};

type CodeServerProxyResponseOptions = CodeServerHtmlResponseOptions& {
  body?: string | null;
  pathname?: string | null;
};

type CodeServerProxyResponseResult = {
  body: string | null;
  classification: CodeServerProxyResponseClassification;
  headers: Record<string, string>;
  statusCode: number;
};

type CodeServerProxyAdapter = {
  browser: CodeServerBrowserBridge;
  buildForwardedHeaders(options: BuildForwardedHeadersOptions): Record<string, string>;
  buildWebSocketHeaders(options: BuildCodeServerWebSocketHeadersOptions): Record<string, string>;
  classifyFailure(options: ClassifyCodeServerProxyFailureOptions): CodeServerProxyFailure;
  classifyResponse(options: CodeServerProxyResponseOptions): CodeServerProxyResponseClassification;
  handleResponse(options: CodeServerProxyResponseOptions): Promise<CodeServerProxyResponseResult>;
  maybeOverrideServiceWorker(pathname?: string | null): CodeServerProxyServiceWorkerOverride | null;
  persistProfile(runtimeDir?: string): Promise<CodeServerProfilePersistResult|null>;
  readonlyPolicy: CodeServerReadonlyPolicy;
  responseRequiresTransform(options: CodeServerProxyResponseOptions): boolean;
};

export type {
  BuildCodeServerWebSocketHeadersOptions,
  BuildForwardedHeadersOptions,
  ClassifyCodeServerProxyFailureOptions,
  CodeServerHtmlResponseOptions,
  CodeServerProfilePersistTrigger,
  CodeServerProxyAdapter,
  CodeServerProxyAdapterOptions,
  CodeServerProxyFailure,
  CodeServerProxyFailureCategory,
  CodeServerProxyResponseClassification,
  CodeServerProxyResponseKind,
  CodeServerProxyResponseOptions,
  CodeServerProxyResponseResult,
  CodeServerProxyServiceWorkerMode,
  CodeServerProxyServiceWorkerOverride,
};
