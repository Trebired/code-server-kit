import { createBrowserDiagnosticsScript } from "./script.js";
import { normalizeTransport } from "./transport.js";
import { createHtmlInjectionPlan } from "./injection-plan.js";
import { escapeHtml, escapeHtmlAttribute } from "./shared.js";
import type {
  CodeServerHtmlAppearanceOptions,
  TransformCodeServerHtmlOptions,
} from "#3c8d8166992a";

function transformCodeServerHtml(options: TransformCodeServerHtmlOptions): string {
  const script = createBrowserDiagnosticsScript({
      bridgeProperty: options.diagnostics?.bridgeProperty,
      embed: options.embed,
      policy: options.diagnostics?.policy,
      readonly: options.readonly,
      sessionKey: options.sessionKey,
      theme: options.theme,
      transport: normalizeTransport(options.diagnostics?.transport).getRuntimeConfig(),
  });

  let html = applyAppearance(options.html, options.appearance);

  if (options.stripEmptyModuleScripts) {
    html = html.replace(/<script\b[^>]*type=(["'])module\1[^>]*>\s*<\/script>/gi, "");
  }

  if (options.stripKnownBrokenModuleScripts) {
    html = html.replace(/<script\b[^>]*type=(["'])module\1[^>]*src=(["'])(?:\s*|about:blank)\2[^>]*>\s*<\/script>/gi, "");
  }

  return createHtmlInjectionPlan({
      nonce: options.cspNonce,
      script,
      strategy: options.injectStrategy,
  }).apply(html);
}

function injectCodeServerBrowserBridgeHtml(options: TransformCodeServerHtmlOptions): string {
  return transformCodeServerHtml(options);
}

function applyAppearance(html: string, options?: CodeServerHtmlAppearanceOptions): string {
  if (!options) {
    return html;
  }

  let next = html;

  if (options.title) {
    if (/<title>.*<\/title>/i.test(next)) {
      next = next.replace(/<title>.*<\/title>/i, `<title>${escapeHtml(options.title)}</title>`);
    } else if (next.includes("<head>")) {
      next = next.replace("<head>", `<head><title>${escapeHtml(options.title)}</title>`);
    }
  }

  if (options.faviconHref) {
    const favicon = `<link rel="icon" href="${escapeHtmlAttribute(options.faviconHref)}">`;
    if (/<link\b[^>]*rel=(["'])icon\1[^>]*>/i.test(next)) {
      next = next.replace(/<link\b[^>]*rel=(["'])icon\1[^>]*>/i, favicon);
    } else if (next.includes("<head>")) {
      next = next.replace("<head>", `<head>${favicon}`);
    }
  }

  if (options.stylesheetHref && next.includes("<head>")) {
    const stylesheet = `<link rel="stylesheet" href="${escapeHtmlAttribute(options.stylesheetHref)}">`;
    next = next.replace("<head>", `<head>${stylesheet}`);
  }

  if (options.colorScheme) {
    const meta = `<meta name="color-scheme" content="${escapeHtmlAttribute(options.colorScheme)}">`;
    if (/<meta\b[^>]*name=(["'])color-scheme\1[^>]*>/i.test(next)) {
      next = next.replace(/<meta\b[^>]*name=(["'])color-scheme\1[^>]*>/i, meta);
    } else if (next.includes("<head>")) {
      next = next.replace("<head>", `<head>${meta}`);
    }
  }

  if (options.bodyData && Object.keys(options.bodyData).length > 0) {
    const attributes = Object.entries(options.bodyData)
    .map(([key, value]) => ` data-${escapeHtmlAttribute(key)}="${escapeHtmlAttribute(value)}"`)
    .join("");
    next = next.replace(/<body([^>]*)>/i, `<body$1${attributes}>`);
  }

  return next;
}

export { transformCodeServerHtml };
export { injectCodeServerBrowserBridgeHtml };
