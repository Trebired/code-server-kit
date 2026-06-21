import { createCodeServerBrowserBridge } from "./browser/index.js";
import { createReadonlyBrowserPolicy } from "./readonly.js";
import { CodeServerInvalidConfigurationError } from "./errors.js";
import type {
  BuildCodeServerWebSocketHeadersOptions,
  BuildForwardedHeadersOptions,
  ClassifyCodeServerProxyFailureOptions,
  CodeServerBrowserBridge,
  CodeServerBrowserBridgeOptions,
  CodeServerHtmlResponseOptions,
  CodeServerProxyAdapter,
  CodeServerProxyAdapterOptions,
  CodeServerProxyFailure,
  CodeServerProxyResponseClassification,
  CodeServerProxyResponseOptions,
  CodeServerProxyResponseResult,
  CodeServerProxyServiceWorkerOverride,
} from "./types.js";

function buildForwardedHeaders(options: BuildForwardedHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const host = normalizeOptionalString(options.forwardedHost ?? options.host);
  const proto = normalizeOptionalString(options.forwardedProto ?? options.proto);
  const port = normalizeOptionalString(options.port == null ? undefined : String(options.port));
  const forwardedFor = normalizeForwardedFor(options.forwardedFor);

  if (host) headers["x-forwarded-host"] = host;
  if (proto) headers["x-forwarded-proto"] = proto;
  if (port) headers["x-forwarded-port"] = port;
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;

  if (proto && host) {
    const authority = port && !host.includes(":") && port !== defaultPortForProto(proto)
      ? `${host}:${port}`
      : host;
    headers["forwarded"] = `proto=${proto};host=${authority}`;
  }

  return headers;
}

function isCodeServerHtmlResponse(options: CodeServerHtmlResponseOptions): boolean {
  const method = normalizeOptionalString(options.method)?.toUpperCase();
  if (method === "HEAD") return false;

  const statusCode = options.statusCode ?? 200;
  if (statusCode < 200 || statusCode >= 300) return false;

  const contentType = normalizeContentType(options);
  return contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml");
}

function buildCodeServerWebSocketHeaders(options: BuildCodeServerWebSocketHeadersOptions): Record<string, string> {
  return {
    ...buildForwardedHeaders(options),
    "connection": normalizeOptionalString(options.connection) ?? "Upgrade",
    "upgrade": normalizeOptionalString(options.upgrade) ?? "websocket",
  };
}

function classifyCodeServerProxyFailure(options: ClassifyCodeServerProxyFailureOptions): CodeServerProxyFailure {
  const errorCode = typeof options.error === "object" && options.error && "code" in options.error
    ? String(options.error.code)
    : null;
  const statusCode = options.statusCode ?? null;

  if (errorCode === "ECONNREFUSED" || statusCode === 502) {
    return {
      category: "refused",
      details: {
        code: errorCode,
        statusCode,
      },
      message: "The code-server upstream refused the connection.",
    };
  }

  if (errorCode === "ECONNRESET") {
    return {
      category: "reset",
      details: {
        code: errorCode,
        statusCode,
      },
      message: "The code-server upstream reset the connection.",
    };
  }

  if (errorCode === "ETIMEDOUT" || statusCode === 504) {
    return {
      category: "timeout",
      details: {
        code: errorCode,
        statusCode,
      },
      message: "The code-server upstream timed out.",
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      category: "upstream_failure",
      details: {
        code: errorCode,
        statusCode,
      },
      message: "The code-server upstream returned an error.",
    };
  }

  return {
    category: "unknown",
    details: {
      code: errorCode,
      statusCode,
    },
    message: "The code-server upstream request failed.",
  };
}

function createCodeServerProxyAdapter(options: CodeServerProxyAdapterOptions = {}): CodeServerProxyAdapter {
  const browserOptions = isBrowserBridge(options.browser)
    ? undefined
    : options.browser;
  const browser = isBrowserBridge(options.browser)
    ? options.browser
    : createCodeServerBrowserBridge({
      ...(browserOptions ?? {}),
      readonly: options.readonly ?? browserOptions?.readonly,
    });
  const readonlyPolicy = createReadonlyBrowserPolicy(options.readonly ?? browser.readonlyPolicy);
  const profile = options.profile ?? null;
  const profilePersistTrigger = options.profilePersistTrigger ?? "manual";
  const serviceWorker = normalizeServiceWorkerOverride(options.serviceWorker);

  return {
    browser,
    buildForwardedHeaders,
    buildWebSocketHeaders: buildCodeServerWebSocketHeaders,
    classifyFailure: classifyCodeServerProxyFailure,
    classifyResponse(input) {
      if (matchesServiceWorkerOverride(input.pathname, serviceWorker)) {
        return {
          kind: "service-worker-override",
          reason: "service worker override route matched",
          stripBodyHeaders: true,
        };
      }

      if (isCodeServerHtmlResponse(input)) {
        return {
          kind: "transform",
          reason: "HTML response requires code-server browser bridge injection",
          stripBodyHeaders: true,
        };
      }

      return {
        kind: "passthrough",
        reason: "response can pass through without package-owned mutation",
        stripBodyHeaders: false,
      };
    },
    async handleResponse(input) {
      const classification = this.classifyResponse(input);
      let result: CodeServerProxyResponseResult;

      if (classification.kind === "service-worker-override") {
        const override = this.maybeOverrideServiceWorker(input.pathname);
        result = {
          body: override?.body ?? null,
          classification,
          headers: override
            ? {
              ...override.headers,
              "content-type": override.contentType,
            }
            : {},
          statusCode: override?.statusCode ?? input.statusCode ?? 200,
        };
      } else if (classification.kind === "transform") {
        const headers = normalizeResponseHeaders(input.headers);
        const body = browser.injectHtml({
          ...options.html,
          html: input.body ?? "",
        });
        result = {
          body,
          classification,
          headers: classification.stripBodyHeaders
            ? stripTransformHeaders(headers)
            : headers,
          statusCode: input.statusCode ?? 200,
        };
      } else {
        result = {
          body: input.body ?? null,
          classification,
          headers: normalizeResponseHeaders(input.headers),
          statusCode: input.statusCode ?? 200,
        };
      }

      if (profile && options.profileRuntimeDir && shouldTriggerProfilePersist(profilePersistTrigger, result.classification.kind)) {
        await profile.schedulePersistRuntimeProfile(options.profileRuntimeDir);
      }

      await options.postResponse?.(result);
      return result;
    },
    maybeOverrideServiceWorker(pathname) {
      if (!matchesServiceWorkerOverride(pathname, serviceWorker) || !serviceWorker) {
        return null;
      }

      return {
        body: serviceWorker.body,
        contentType: serviceWorker.contentType,
        headers: {
          "cache-control": "no-store",
          ...serviceWorker.headers,
        },
        pathname: serviceWorker.pathname,
        statusCode: serviceWorker.statusCode,
      };
    },
    async persistProfile(runtimeDir) {
      if (!profile) {
        return null;
      }

      const targetDir = runtimeDir ?? options.profileRuntimeDir;
      if (!targetDir) {
        return null;
      }

      return await profile.persistRuntimeProfile(targetDir);
    },
    readonlyPolicy,
    responseRequiresTransform(input) {
      return this.classifyResponse(input).kind === "transform";
    },
  };
}

function normalizeTrustedOrigin(value: string): string {
  try {
    const origin = new URL(value).origin;
    if (origin === "null") {
      throw new Error("null-origin");
    }
    return origin;
  } catch {
    throw new CodeServerInvalidConfigurationError("Trusted origin values must be absolute origins.", {
      value,
    });
  }
}

function normalizeResponseHeaders(headers?: Headers | Record<string, unknown>): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = String(value[0] ?? "");
    } else if (value != null) {
      normalized[key.toLowerCase()] = String(value);
    }
  }
  return normalized;
}

function stripTransformHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  delete next["content-encoding"];
  delete next["content-length"];
  delete next["etag"];
  delete next["transfer-encoding"];
  return next;
}

function normalizeServiceWorkerOverride(
  options: CodeServerProxyAdapterOptions["serviceWorker"],
): CodeServerProxyServiceWorkerOverride | null {
  if (!options || options.mode === "passthrough") {
    return null;
  }

  return {
    body: options.body ?? DEFAULT_NEUTRALIZED_SERVICE_WORKER,
    contentType: options.contentType ?? "application/javascript; charset=utf-8",
    headers: {
      ...(options.headers ?? {}),
    },
    pathname: normalizeServiceWorkerPathname(options.pathname),
    statusCode: options.statusCode ?? 200,
  };
}

function normalizeServiceWorkerPathname(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "/service-worker.js";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function matchesServiceWorkerOverride(
  pathname: string | null | undefined,
  override: CodeServerProxyServiceWorkerOverride | null,
): boolean {
  return Boolean(override && pathname && pathname === override.pathname);
}

function shouldTriggerProfilePersist(
  trigger: CodeServerProxyAdapterOptions["profilePersistTrigger"] | undefined,
  kind: CodeServerProxyResponseClassification["kind"],
): boolean {
  return trigger === "every-response" || (trigger === "transformed-html" && kind === "transform");
}

function isBrowserBridge(
  value?: CodeServerBrowserBridge | CodeServerBrowserBridgeOptions,
): value is CodeServerBrowserBridge {
  return Boolean(value)
    && typeof value === "object"
    && "injectHtml" in value
    && typeof value.injectHtml === "function";
}

function normalizeContentType(options: CodeServerHtmlResponseOptions): string {
  if (typeof options.contentType === "string") {
    return options.contentType.toLowerCase();
  }

  const headers = options.headers;
  if (!headers) return "";

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return String(headers.get("content-type") || "").toLowerCase();
  }

  const headerValue = headers["content-type"] ?? headers["Content-Type"];
  if (Array.isArray(headerValue)) {
    return String(headerValue[0] || "").toLowerCase();
  }

  return typeof headerValue === "string"
    ? headerValue.toLowerCase()
    : "";
}

function normalizeForwardedFor(value?: string | string[]): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }

  if (!Array.isArray(value)) return null;

  const values = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);

  return values.length ? values.join(", ") : null;
}

function defaultPortForProto(value: string): string | null {
  if (value === "http") return "80";
  if (value === "https") return "443";
  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export {
  createCodeServerProxyAdapter,
  buildCodeServerWebSocketHeaders,
  buildForwardedHeaders,
  classifyCodeServerProxyFailure,
  isCodeServerHtmlResponse,
  normalizeTrustedOrigin,
};

const DEFAULT_NEUTRALIZED_SERVICE_WORKER = [
  "self.addEventListener('install',function(event){self.skipWaiting();});",
  "self.addEventListener('activate',function(event){event.waitUntil(self.clients.claim());});",
  "self.addEventListener('fetch',function(){});",
].join("");
