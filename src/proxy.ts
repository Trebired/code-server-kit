import { CodeServerInvalidConfigurationError } from "./errors.js";
import type {
  BuildCodeServerWebSocketHeadersOptions,
  BuildForwardedHeadersOptions,
  ClassifyCodeServerProxyFailureOptions,
  CodeServerHtmlResponseOptions,
  CodeServerProxyFailure,
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
  buildCodeServerWebSocketHeaders,
  buildForwardedHeaders,
  classifyCodeServerProxyFailure,
  isCodeServerHtmlResponse,
  normalizeTrustedOrigin,
};
