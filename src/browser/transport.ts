import { DEFAULT_TRANSPORT_RUNTIME } from "./constants.js";
import { parseIncomingBrowserEvents, normalizePositiveInteger } from "./shared.js";
import type {
  CodeServerBrowserDiagnosticEvent,
  CodeServerBrowserDiagnosticsRuntimeTransport,
  CodeServerBrowserDiagnosticsTransport,
  CodeServerBrowserDiagnosticsTransportOptions,
  CodeServerSanitizerOptions,
} from "#gk2pmrelxtj4";

function createBrowserDiagnosticsTransport(
  options: CodeServerBrowserDiagnosticsTransportOptions = {},
): CodeServerBrowserDiagnosticsTransport {
  const runtime = normalizeTransportRuntimeConfig(options);
  const events: CodeServerBrowserDiagnosticEvent[] = [];

  return {
    clear() {
      events.length = 0;
    },
    async deliver(input) {
      const payload = Array.isArray(input) ? input : [input];
      events.push(...payload);
      await deliverBrowserDiagnostics(runtime, payload);
    },
    getBufferedEvents() {
      return [...events];
    },
    getRuntimeConfig() {
      return { ...runtime };
    },
    mode: runtime.mode,
    parseMessage(data: unknown, sanitizer?: CodeServerSanitizerOptions) {
      return parseIncomingBrowserEvents(data, sanitizer);
    },
  };
}

async function deliverBrowserDiagnostics(
  runtime: CodeServerBrowserDiagnosticsRuntimeTransport,
  payload: CodeServerBrowserDiagnosticEvent[],
): Promise<void> {
  const browserWindow = resolveBrowserWindow();
  if (runtime.mode === "memory") {
    resolveGlobalArray(runtime.arrayName).push(...payload);
    return;
  }
  if (runtime.mode === "callback") {
    const callback = resolveGlobalFunction(runtime.callbackName);
    if (callback) await Promise.resolve(callback(payload));
    return;
  }
  if (runtime.mode === "postmessage") {
    if (browserWindow?.parent && browserWindow.parent !== browserWindow) {
      browserWindow.parent.postMessage({ events: payload, type: runtime.messageType }, runtime.targetOrigin);
    }
    return;
  }
  if (runtime.endpointUrl && typeof fetch === "function") {
    await postBrowserDiagnostics(runtime, payload);
  }
}

function normalizeTransportRuntimeConfig(
  options: CodeServerBrowserDiagnosticsTransportOptions | CodeServerBrowserDiagnosticsRuntimeTransport | undefined,
): CodeServerBrowserDiagnosticsRuntimeTransport {
  return {
    arrayName: options?.arrayName ?? DEFAULT_TRANSPORT_RUNTIME.arrayName,
    batchSize: normalizePositiveInteger(options?.batchSize, DEFAULT_TRANSPORT_RUNTIME.batchSize),
    callbackName: options?.callbackName ?? DEFAULT_TRANSPORT_RUNTIME.callbackName,
    debounceMs: normalizePositiveInteger(options?.debounceMs, DEFAULT_TRANSPORT_RUNTIME.debounceMs),
    endpointUrl: options?.endpointUrl,
    headers: options?.headers ? { ...options.headers } : undefined,
    keepalive: options?.keepalive ?? DEFAULT_TRANSPORT_RUNTIME.keepalive,
    messageType: options?.messageType ?? DEFAULT_TRANSPORT_RUNTIME.messageType,
    mode: options?.mode ?? DEFAULT_TRANSPORT_RUNTIME.mode,
    preferSendBeacon: options?.preferSendBeacon ?? DEFAULT_TRANSPORT_RUNTIME.preferSendBeacon,
    retryCount: normalizePositiveInteger(options?.retryCount, DEFAULT_TRANSPORT_RUNTIME.retryCount),
    targetOrigin: options?.targetOrigin ?? DEFAULT_TRANSPORT_RUNTIME.targetOrigin,
  };
}

function isTransport(
  value?: CodeServerBrowserDiagnosticsTransport | CodeServerBrowserDiagnosticsTransportOptions,
): value is CodeServerBrowserDiagnosticsTransport {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as CodeServerBrowserDiagnosticsTransport).deliver === "function"
    && typeof (value as CodeServerBrowserDiagnosticsTransport).parseMessage === "function";
}

function normalizeTransport(
  transport?: CodeServerBrowserDiagnosticsTransport | CodeServerBrowserDiagnosticsTransportOptions,
): CodeServerBrowserDiagnosticsTransport {
  return isTransport(transport)
    ? transport
    : createBrowserDiagnosticsTransport(transport);
}

function resolveGlobalArray(name = DEFAULT_TRANSPORT_RUNTIME.arrayName): unknown[] {
  const globalObject = globalThis as Record<string, unknown>;
  const current = globalObject[name];
  if (Array.isArray(current)) {
    return current;
  }

  const next: unknown[] = [];
  globalObject[name] = next;
  return next;
}

function resolveGlobalFunction(name = DEFAULT_TRANSPORT_RUNTIME.callbackName): ((...args: unknown[]) => unknown) | null {
  const value = (globalThis as Record<string, unknown>)[name];
  return typeof value === "function"
    ? value as (...args: unknown[]) => unknown
    : null;
}

function resolveBrowserWindow(): {
  parent?: {
    postMessage?(message: unknown, targetOrigin: string): void;
  };
} | null {
  if (typeof globalThis !== "object" || !("window" in globalThis)) {
    return null;
  }

  const candidate = (globalThis as Record<string, unknown>).window;
  return candidate && typeof candidate === "object"
    ? candidate as { parent?: { postMessage?(message: unknown, targetOrigin: string): void } }
    : null;
}

async function postBrowserDiagnostics(
  runtime: CodeServerBrowserDiagnosticsRuntimeTransport,
  events: CodeServerBrowserDiagnosticEvent[],
): Promise<void> {
  if (!runtime.endpointUrl || typeof fetch !== "function") {
    return;
  }

  const payload = JSON.stringify({
    events,
    type: runtime.messageType,
  });
  const headers = {
    "content-type": "application/json",
    ...(runtime.headers ?? {}),
  };

  let attempts = 0;
  while (attempts <= runtime.retryCount) {
    attempts += 1;
    try {
      const response = await fetch(runtime.endpointUrl, {
        body: payload,
        headers,
        keepalive: runtime.keepalive,
        method: "POST",
      });

      if (response.ok || attempts > runtime.retryCount) {
        return;
      }
    } catch (error) {
      if (attempts > runtime.retryCount) {
        throw error;
      }
    }
  }
}

export {
  createBrowserDiagnosticsTransport,
  isTransport,
  normalizeTransport,
  normalizeTransportRuntimeConfig,
};
