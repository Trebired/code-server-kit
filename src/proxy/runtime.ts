import { createCodeServerBrowserBridge } from "#8392d406df71";
import { createReadonlyBrowserPolicy } from "#ad2fd7ec5e18";
import {
  buildCodeServerWebSocketHeaders,
  buildForwardedHeaders,
  classifyCodeServerProxyFailure,
  isCodeServerHtmlResponse,
  matchesServiceWorkerOverride,
  normalizeResponseHeaders,
  normalizeServiceWorkerOverride,
  shouldTriggerProfilePersist,
  stripTransformHeaders,
} from "./shared.js";
import type {
  CodeServerBrowserBridge,
  CodeServerBrowserBridgeOptions,
  CodeServerProxyAdapter,
  CodeServerProxyAdapterOptions,
  CodeServerProxyResponseClassification,
  CodeServerProxyResponseOptions,
  CodeServerProxyResponseResult,
} from "#3c8d8166992a";

function createCodeServerProxyAdapter(options: CodeServerProxyAdapterOptions = {}): CodeServerProxyAdapter {
  const context = resolveProxyContext(options);
  return {
    browser: context.browser,
    buildForwardedHeaders,
    buildWebSocketHeaders: buildCodeServerWebSocketHeaders,
    classifyFailure: classifyCodeServerProxyFailure,
    classifyResponse(input) {
      return classifyProxyResponse(input, context.serviceWorker);
    },
    async handleResponse(input) {
      const result = await resolveProxyResponse(options, context, input);
      await maybePersistProxyProfile(options, context, result);
      await options.postResponse?.(result);
      return result;
    },
    maybeOverrideServiceWorker(pathname) {
      if (!matchesServiceWorkerOverride(pathname, context.serviceWorker) || !context.serviceWorker) return null;
      return buildServiceWorkerResponse(context.serviceWorker);
    },
    async persistProfile(runtimeDir) {
      if (!context.profile) return null;
      const targetDir = runtimeDir ?? options.profileRuntimeDir;
      if (!targetDir) return null;
      return await context.profile.persistRuntimeProfile(targetDir);
    },
    readonlyPolicy: context.readonlyPolicy,
    responseRequiresTransform(input) {
      return classifyProxyResponse(input, context.serviceWorker).kind === "transform";
    },
  };
}

function resolveProxyContext(options: CodeServerProxyAdapterOptions) {
  const browserOptions = isBrowserBridge(options.browser) ? undefined : options.browser;
  const browser = isBrowserBridge(options.browser)
    ? options.browser
    : createCodeServerBrowserBridge({
      ...(browserOptions ?? {}),
      readonly: options.readonly ?? browserOptions?.readonly,
    });
  return {
    browser,
    profile: options.profile ?? null,
    profilePersistTrigger: options.profilePersistTrigger ?? "manual",
    readonlyPolicy: createReadonlyBrowserPolicy(options.readonly ?? browser.readonlyPolicy),
    serviceWorker: normalizeServiceWorkerOverride(options.serviceWorker),
  };
}

function classifyProxyResponse(
  input: CodeServerProxyResponseOptions,
  serviceWorker: ReturnType<typeof normalizeServiceWorkerOverride>,
): CodeServerProxyResponseClassification {
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
}

async function resolveProxyResponse(
  options: CodeServerProxyAdapterOptions,
  context: ReturnType<typeof resolveProxyContext>,
  input: CodeServerProxyResponseOptions,
): Promise<CodeServerProxyResponseResult> {
  const classification = classifyProxyResponse(input, context.serviceWorker);
  if (classification.kind === "service-worker-override") {
    const override = context.serviceWorker ? buildServiceWorkerResponse(context.serviceWorker) : null;
    return {
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
  }

  if (classification.kind === "transform") {
    const headers = normalizeResponseHeaders(input.headers);
    const body = context.browser.injectHtml({
      ...options.html,
      html: input.body ?? "",
    });
    return {
      body,
      classification,
      headers: classification.stripBodyHeaders ? stripTransformHeaders(headers) : headers,
      statusCode: input.statusCode ?? 200,
    };
  }

  return {
    body: input.body ?? null,
    classification,
    headers: normalizeResponseHeaders(input.headers),
    statusCode: input.statusCode ?? 200,
  };
}

async function maybePersistProxyProfile(
  options: CodeServerProxyAdapterOptions,
  context: ReturnType<typeof resolveProxyContext>,
  result: CodeServerProxyResponseResult,
): Promise<void> {
  if (!context.profile || !options.profileRuntimeDir) return;
  if (!shouldTriggerProfilePersist(context.profilePersistTrigger, result.classification.kind)) return;
  await context.profile.schedulePersistRuntimeProfile(options.profileRuntimeDir);
}

function buildServiceWorkerResponse(serviceWorker: NonNullable<ReturnType<typeof normalizeServiceWorkerOverride>>) {
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
}

function isBrowserBridge(
  value?: CodeServerBrowserBridge | CodeServerBrowserBridgeOptions,
): value is CodeServerBrowserBridge {
  return Boolean(value)
    && typeof value === "object"
    && "injectHtml" in value
    && typeof value.injectHtml === "function";
}

export { createCodeServerProxyAdapter };
