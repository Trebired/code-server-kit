import { describe, expect, test } from "bun:test";

import {
  CodeServerInvalidConfigurationError,
  normalizeCodeServerStartupFailure,
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
      code: "invalid_configuration",
      details: {
        field: "trustedOrigins",
      },
      isCodeServerKitError: true,
      message: "bad config",
      name: "CodeServerInvalidConfigurationError",
    });
  });

  test("normalizes generic errors too", () => {
    const normalized = normalizeCodeServerStartupFailure(new Error("boom"));

    expect(normalized).toEqual({
      code: null,
      details: {},
      isCodeServerKitError: false,
      message: "boom",
      name: "Error",
    });
  });
});
