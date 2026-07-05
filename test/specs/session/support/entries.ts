const LISTENING_ENTRY = `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const bindAddr = readArg("--bind-addr") || "127.0.0.1:8080";
const userDataDir = readArg("--user-data-dir");
const host = bindAddr.startsWith("[")
  ? bindAddr.slice(1, bindAddr.indexOf("]"))
  : bindAddr.slice(0, bindAddr.lastIndexOf(":"));
const portText = bindAddr.startsWith("[")
  ? bindAddr.slice(bindAddr.indexOf("]:") + 2)
  : bindAddr.slice(bindAddr.lastIndexOf(":") + 1);
const port = Number(portText);

if (userDataDir) {
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  if (fs.existsSync(path.join(userDataDir, "User", "settings.json"))) {
    fs.writeFileSync(path.join(userDataDir, "User", "settings.json"), JSON.stringify({ restored: true, runtime: true }, null, 2) + "\\n");
  }
  fs.writeFileSync(path.join(userDataDir, "User", "keybindings.json"), "[]\\n");
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});

server.listen(port, host, () => {
  process.stdout.write("listening\\n");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;

const DELAYED_LISTENING_ENTRY = `#!/usr/bin/env node
const http = require("node:http");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const bindAddr = readArg("--bind-addr") || "127.0.0.1:8080";
const host = bindAddr.slice(0, bindAddr.lastIndexOf(":"));
const port = Number(bindAddr.slice(bindAddr.lastIndexOf(":") + 1));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});

setTimeout(() => {
  server.listen(port, host, () => process.stdout.write("listening\\n"));
}, 250);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;

export { DELAYED_LISTENING_ENTRY, LISTENING_ENTRY };
