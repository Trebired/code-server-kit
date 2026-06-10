import net from "node:net";

import { describe, expect, test } from "bun:test";

import {
  CodeServerProcessExitedBeforeReadyError,
  CodeServerStartupTimeoutError,
  waitForCodeServerReady,
} from "../../src/index.js";
import { closeServer, getFreePort, sleep } from "./helpers.js";

describe("@trebired/code-server-kit readiness", () => {
  test("waits until the TCP port starts accepting connections", async () => {
    const port = await getFreePort();
    const server = net.createServer((socket) => {
      socket.end();
    });

    setTimeout(() => {
      server.listen(port, "127.0.0.1");
    }, 120);

    try {
      const ready = await waitForCodeServerReady({
        host: "127.0.0.1",
        port,
        retryIntervalMs: 25,
        timeoutMs: 2_000,
      });

      expect(ready.host).toBe("127.0.0.1");
      expect(ready.port).toBe(port);
      expect(ready.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      if (server.listening) {
        await closeServer(server);
      } else {
        await sleep(200);
        if (server.listening) {
          await closeServer(server);
        }
      }
    }
  });

  test("throws a structured startup timeout when the port never opens", async () => {
    const port = await getFreePort();

    await expect(waitForCodeServerReady({
      host: "127.0.0.1",
      port,
      retryIntervalMs: 20,
      timeoutMs: 120,
    })).rejects.toBeInstanceOf(CodeServerStartupTimeoutError);
  });

  test("throws a structured exit error when the process dies before readiness", async () => {
    const port = await getFreePort();
    const processHandle = {
      args: [],
      bindAddr: `127.0.0.1:${port}`,
      child: null as any,
      codeServerPackageRoot: "/tmp/fake",
      command: "/tmp/fake/bin/code-server",
      exit: (async () => {
        await sleep(60);
        return {
          code: 1,
          signal: null,
        };
      })(),
      extensionsDir: "/tmp/fake/extensions",
      getStderr() {
        return "fatal";
      },
      getStdout() {
        return "booting";
      },
      host: "127.0.0.1",
      kill() {
        return true;
      },
      launchMode: "direct" as const,
      pid: 123,
      port,
      supportRoot: null,
      userDataDir: "/tmp/fake/user-data",
      workspacePath: null,
    };

    await expect(waitForCodeServerReady({
      host: "127.0.0.1",
      port,
      process: processHandle,
      retryIntervalMs: 20,
      timeoutMs: 500,
    })).rejects.toBeInstanceOf(CodeServerProcessExitedBeforeReadyError);
  });
});
