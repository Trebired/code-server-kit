import net from "node:net";

function canConnectToHost(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      let settled = false;

      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(Math.max(timeoutMs, 1));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
  });
}

function formatReadyHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export {
  canConnectToHost,
  formatReadyHost,
  sleep,
};
