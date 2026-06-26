import { describe, expect, test } from "bun:test";

import {
  createReadonlySessionPolicy,
  evaluateReadonlyBrowserAction,
} from "#c0ucu2gxeffq";

describe("@trebired/code-server-kit readonly", () => {
  test("normalizes a filesystem-backed readonly policy by default", () => {
    const policy = createReadonlySessionPolicy({
      enabled: true,
      mode: "view",
    });

    expect(policy.enabled).toBe(true);
    expect(policy.filesystem.mode).toBe("auto");
    expect(policy.browserGuards.blockCommandLinks).toBe(true);
    expect(policy.browserGuards.blockedCommandLinkSchemes).toEqual(["command"]);
  });

  test("blocks writable-session promotions by command identity and command URI", () => {
    const policy = createReadonlySessionPolicy(true);
    const command = evaluateReadonlyBrowserAction(policy, {
      commandId: "workbench.action.files.setActiveEditorWriteableInSession",
      kind: "command",
    });
    const commandUri = evaluateReadonlyBrowserAction(policy, {
      href: "command:workbench.action.files.toggleActiveEditorReadonlyInSession",
      kind: "command-uri",
      source: "notification",
    });

    expect(command.blocked).toBe(true);
    expect(command.reason).toContain("blocked");
    expect(commandUri.blocked).toBe(true);
    expect(commandUri.reason).toContain("command URI");
  });

  test("allows hosts to require a hard filesystem boundary additively", () => {
    const policy = createReadonlySessionPolicy({
      enabled: true,
      filesystem: {
        extraWritablePaths: ["/srv/runtime/cache"],
        mode: "require",
      },
      mode: "view",
    });

    expect(policy.filesystem.mode).toBe("require");
    expect(policy.filesystem.extraWritablePaths).toEqual(["/srv/runtime/cache"]);
  });
});
