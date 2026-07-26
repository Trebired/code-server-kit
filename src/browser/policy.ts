import { DEFAULT_BROWSER_POLICY } from "./constants.js";
import { normalizePositiveInteger, normalizeSelectors } from "./shared.js";
import type { CodeServerBrowserReadinessPolicy } from "#3c8d8166992a";

function browserReadinessPolicy(
  options: Partial<CodeServerBrowserReadinessPolicy> = {},
): CodeServerBrowserReadinessPolicy {
  return {
    bootstrapTimeoutMs: normalizePositiveInteger(
      options.bootstrapTimeoutMs,
      DEFAULT_BROWSER_POLICY.bootstrapTimeoutMs,
    ),
    iframeTimeoutMs: normalizePositiveInteger(
      options.iframeTimeoutMs,
      DEFAULT_BROWSER_POLICY.iframeTimeoutMs ?? 15_000,
    ),
    shellSelectors: normalizeSelectors(options.shellSelectors, DEFAULT_BROWSER_POLICY.shellSelectors),
    stallTimeoutMs: normalizePositiveInteger(
      options.stallTimeoutMs,
      DEFAULT_BROWSER_POLICY.stallTimeoutMs ?? 8_000,
    ),
    target: options.target ?? DEFAULT_BROWSER_POLICY.target,
    workbenchSelectors: normalizeSelectors(
      options.workbenchSelectors,
      DEFAULT_BROWSER_POLICY.workbenchSelectors,
    ),
  };
}

export { browserReadinessPolicy };
