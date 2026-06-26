import { KNOWN_BROWSER_TYPES } from "./constants.js";
import type {
  CodeServerBrowserDiagnosticEvent,
  CodeServerEmbedMessage,
  CodeServerEmbedMessageType,
  CodeServerSanitizerOptions,
} from "#gk2pmrelxtj4";

export function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeSelectors(value: string[] | undefined, fallback: string[] | undefined): string[] {
  const selectors = value?.map((item) => String(item).trim()).filter(Boolean) ?? [];
  if (selectors.length > 0) {
    return [...new Set(selectors)];
  }
  return [...(fallback ?? [])];
}

function normalizeLevel(value: unknown): CodeServerBrowserDiagnosticEvent["level"] {
  return value === "warn" || value === "error" || value === "info"
    ? value
    : "info";
}

function normalizeBrowserType(value: unknown): CodeServerBrowserDiagnosticEvent["type"] {
  return typeof value === "string" && KNOWN_BROWSER_TYPES.has(value as CodeServerBrowserDiagnosticEvent["type"])
    ? value as CodeServerBrowserDiagnosticEvent["type"]
    : "custom";
}

function phaseForBrowserEvent(value: CodeServerBrowserDiagnosticEvent["type"]): CodeServerBrowserDiagnosticEvent["phase"] {
  switch (value) {
    case "websocket-open":
    case "websocket-close":
    case "websocket-error":
      return "websocket-ready";
    case "workbench-mounted":
    case "bootstrap-timeout":
    case "frontend-stalled":
    case "extension-host-stalled":
      return "workbench-ready";
    default:
      return "browser-bootstrap";
  }
}

function isRetryableBrowserEvent(value: CodeServerBrowserDiagnosticEvent["type"]): boolean {
  return value === "websocket-error"
    || value === "websocket-close"
    || value === "bootstrap-timeout"
    || value === "frontend-stalled"
    || value === "resource-error"
    || value === "iframe-timeout";
}

function isFailureEvent(event: CodeServerBrowserDiagnosticEvent): boolean {
  return event.type === "bootstrap-timeout"
    || event.type === "frontend-stalled"
    || event.type === "extension-host-stalled"
    || event.type === "iframe-failure"
    || (event.level === "error" && event.type !== "resource-error");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value
    ? value as Record<string, unknown>
    : {};
}

export function sanitizeText(value: string, sanitizer?: CodeServerSanitizerOptions): string {
  if (!sanitizer) return value;

  let next = value;
  for (const prefix of sanitizer.pathPrefixes ?? []) {
    next = next.split(prefix).join("<redacted-path>");
  }
  for (const current of sanitizer.values ?? []) {
    next = next.split(current).join("<redacted>");
  }
  return sanitizer.replacer ? sanitizer.replacer(next) : next;
}

function sanitizeDetails(
  value: Record<string, unknown>,
  sanitizer?: CodeServerSanitizerOptions,
): Record<string, unknown> {
  if (!sanitizer) return value;

  try {
    return JSON.parse(sanitizeText(JSON.stringify(value), sanitizer)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseBrowserDiagnosticEvent(
  value: unknown,
  sanitizer?: CodeServerSanitizerOptions,
): CodeServerBrowserDiagnosticEvent {
  const object = asRecord(value);
  const type = normalizeBrowserType(object.type);

  return {
    details: sanitizeDetails(asRecord(object.details), sanitizer),
    level: normalizeLevel(object.level),
    phase: phaseForBrowserEvent(type),
    retryable: isRetryableBrowserEvent(type),
    summary: sanitizeText(String(object.summary ?? type), sanitizer),
    timestamp: typeof object.timestamp === "string" ? object.timestamp : new Date().toISOString(),
    type,
  };
}

function parseIncomingBrowserEvents(
  value: unknown,
  sanitizer?: CodeServerSanitizerOptions,
): CodeServerBrowserDiagnosticEvent[] {
  if (Array.isArray(value)) {
    return value.map((item) => parseBrowserDiagnosticEvent(item, sanitizer));
  }

  const record = asRecord(value);
  if (Array.isArray(record.events)) {
    return record.events.map((item) => parseBrowserDiagnosticEvent(item, sanitizer));
  }

  const payloadEvents = asRecord(record.payload).events;
  if (Array.isArray(payloadEvents)) {
    return payloadEvents.map((item) => parseBrowserDiagnosticEvent(item, sanitizer));
  }

  if (record.type) {
    return [parseBrowserDiagnosticEvent(record, sanitizer)];
  }

  return [];
}

function normalizeEmbedMessageType(value: unknown): CodeServerEmbedMessageType | null {
  return value === "failure"
    || value === "ready"
    || value === "status"
    || value === "still-loading"
    || value === "theme"
    || value === "visibility"
    ? value
    : null;
}

function parseEmbedMessage(
  value: unknown,
  channel: string,
  sanitizer?: CodeServerSanitizerOptions,
): CodeServerEmbedMessage | null {
  const record = asRecord(value);
  if (record.channel !== channel) {
    return null;
  }

  const type = normalizeEmbedMessageType(record.type);
  if (!type) {
    return null;
  }

  return {
    channel,
    payload: sanitizeDetails(asRecord(record.payload), sanitizer),
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
    type,
  };
}

function extractRelevantUrl(details: Record<string, unknown>): string | null {
  const candidates = [details.resourceUrl, details.url, details.src, details.href, details.blockedURI];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("\"").join("&quot;")
    .split("<").join("&lt;")
    .split(">").join("&gt;");
}

function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;");
}

export {
  escapeHtml,
  escapeHtmlAttribute,
  extractRelevantUrl,
  isFailureEvent,
  normalizeSelectors,
  parseBrowserDiagnosticEvent,
  parseEmbedMessage,
  parseIncomingBrowserEvents,
  sanitizeDetails,
};
