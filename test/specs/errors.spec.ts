import { describe, expect, test } from "bun:test";

import {
  collectCodeServerStartupDiagnostics,
  CodeServerInvalidConfigurationError,
  normalizeCodeServerStartupFailure,
  sanitizeCodeServerDiagnostics,
} from "../../src/index.js";

describe("@trebired/code-server-kit errors", () => {
  test("normalizes package errors into structured startup failure payloads", () => {
    const normalized = normalizeCodeServerStartupFailure(new CodeServerInvalidConfigurationError(
      "bad config",
      {
        field: "trustedOrigins",
      },
    ));

    expect(normalized).toEqual({
      category: "invalid_configuration",
      code: "invalid_configuration",
      details: {
        field: "trustedOrigins",
      },
      isCodeServerKitError: true,
      name: "CodeServerInvalidConfigurationError",
      launchStrategy: null,
      summary: "The code-server launch configuration is invalid. bad config",
      watchdogMode: undefined,
    });
  });

  test("normalizes generic errors too", () => {
    const normalized = normalizeCodeServerStartupFailure(new Error("boom"));

    expect(normalized).toEqual({
      category: "unknown",
      code: "unknown",
      details: {},
      isCodeServerKitError: false,
      launchStrategy: null,
      name: "Error",
      summary: "boom",
      watchdogMode: undefined,
    });
  });

  test("sanitizes diagnostic output for host-facing errors", () => {
    const diagnostics = collectCodeServerStartupDiagnostics({
      category: "preparation_failed",
      error: new Error("failed at /srv/workspaces/demo and secret-token"),
    });
    const sanitized = sanitizeCodeServerDiagnostics(diagnostics, {
      pathPrefixes: ["/srv/workspaces/demo"],
      values: ["secret-token"],
    });

    expect(sanitized.summary).toContain("<redacted-path>");
    expect(sanitized.summary).toContain("<redacted>");
  });
});
