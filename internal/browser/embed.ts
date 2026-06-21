import { CodeServerStartupProbeError } from "#sm030wd0nb8l";
import { resolveLogger } from "#x0glhnlu9a7x";
import { DEFAULT_EMBED_CHANNEL } from "./constants.js";
import { parseEmbedMessage, normalizePositiveInteger } from "./shared.js";
import { createBrowserDiagnosticsTransport } from "./transport.js";
import type {
  CodeServerEmbedController,
  CodeServerEmbedControllerOptions,
  CodeServerEmbedMessage,
  CodeServerEmbedMessageType,
  CodeServerEmbedState,
} from "#gk2pmrelxtj4";

function createCodeServerEmbedController(
  options: CodeServerEmbedControllerOptions = {},
): CodeServerEmbedController {
  const controller = createEmbedControllerState(options);

  return {
    createChildTransport() {
      return createBrowserDiagnosticsTransport({
        messageType: "trebired:code-server-diagnostics",
        mode: "postmessage",
        targetOrigin: controller.state.targetOrigin,
      });
    },
    createStatusMessage(type: CodeServerEmbedMessageType, payload = {}) {
      return createEmbedStatusMessage(controller.channel, type, payload);
    },
    getState() {
      return {
        events: [...controller.events],
        lastMessage: controller.state.lastMessage,
        ready: controller.state.ready,
        state: controller.state.state,
        targetOrigin: controller.state.targetOrigin,
        visible: controller.state.visible,
      };
    },
    handleMessage(data) {
      const message = parseEmbedMessage(data, controller.channel, options.sanitizer);
      if (!message) return null;
      pushEmbedMessage(controller, message);
      return message;
    },
    recordVisibility(visible) {
      const message = createEmbedStatusMessage(controller.channel, "visibility", { visible });
      pushEmbedMessage(controller, message);
      return message;
    },
    waitForReady(waitOptions = {}) {
      if (controller.state.ready && controller.state.lastMessage) {
        return Promise.resolve(controller.state.lastMessage);
      }
      return waitForEmbedReady(controller, waitOptions.timeoutMs);
    },
  };
}

function createEmbedControllerState(options: CodeServerEmbedControllerOptions) {
  return {
    channel: options.channel ?? DEFAULT_EMBED_CHANNEL,
    events: [] as CodeServerEmbedMessage[],
    loadTimeoutMs: normalizePositiveInteger(options.loadTimeoutMs, 15_000),
    log: resolveLogger(options.logger, options.loggerAdapter),
    state: {
      lastMessage: null as CodeServerEmbedMessage | null,
      ready: false,
      state: "idle" as CodeServerEmbedState,
      targetOrigin: options.targetOrigin ?? "*",
      visible: true,
    },
    waiters: new Set<{
      reject(error: Error): void;
      resolve(message: CodeServerEmbedMessage): void;
      timer: ReturnType<typeof setTimeout>;
    }>(),
  };
}

function createEmbedStatusMessage(
  channel: string,
  type: CodeServerEmbedMessageType,
  payload: Record<string, unknown>,
): CodeServerEmbedMessage {
  return {
    channel,
    payload,
    timestamp: new Date().toISOString(),
    type,
  };
}

function pushEmbedMessage(
  controller: ReturnType<typeof createEmbedControllerState>,
  message: CodeServerEmbedMessage,
): void {
  controller.events.push(message);
  controller.state.lastMessage = message;
  controller.log.info("browser:embed", `Embed ${message.type}`, {
    channel: message.channel,
    payload: message.payload,
    type: message.type,
  });

  if (message.type === "ready") {
    controller.state.ready = true;
    controller.state.state = "ready";
    resolveEmbedWaiters(controller, message);
    return;
  }
  if (message.type === "failure") {
    controller.state.ready = false;
    controller.state.state = "failed";
    rejectEmbedWaiters(controller, message);
    return;
  }
  if (message.type === "still-loading") {
    controller.state.state = "stalled";
    return;
  }
  if (message.type === "visibility") {
    controller.state.visible = message.payload.visible !== false;
    return;
  }
  controller.state.state = "loading";
}

function resolveEmbedWaiters(
  controller: ReturnType<typeof createEmbedControllerState>,
  message: CodeServerEmbedMessage,
): void {
  for (const waiter of [...controller.waiters]) {
    clearTimeout(waiter.timer);
    controller.waiters.delete(waiter);
    waiter.resolve(message);
  }
}

function rejectEmbedWaiters(
  controller: ReturnType<typeof createEmbedControllerState>,
  message: CodeServerEmbedMessage,
): void {
  for (const waiter of [...controller.waiters]) {
    clearTimeout(waiter.timer);
    controller.waiters.delete(waiter);
    waiter.reject(new CodeServerStartupProbeError("Embedded code-server reported a browser-side failure.", {
      channel: controller.channel,
      payload: message.payload,
      phase: "browser-bootstrap",
    }));
  }
}

function waitForEmbedReady(
  controller: ReturnType<typeof createEmbedControllerState>,
  timeoutMs?: number,
): Promise<CodeServerEmbedMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.waiters.delete(waiter);
      reject(new CodeServerStartupProbeError("Timed out waiting for the embedded code-server frame to report ready.", {
        channel: controller.channel,
        loadTimeoutMs: controller.loadTimeoutMs,
        phase: "browser-bootstrap",
        targetOrigin: controller.state.targetOrigin,
      }));
    }, normalizePositiveInteger(timeoutMs, controller.loadTimeoutMs));

    const waiter = { reject, resolve, timer };
    controller.waiters.add(waiter);
  });
}

export { createCodeServerEmbedController };
