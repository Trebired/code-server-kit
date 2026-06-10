import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function tempDir(): string {
  const parent = path.join(os.tmpdir(), "@trebired-code-server-kit");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "test_"));
}

function writeFile(root: string, relativePath: string, contents: string, mode?: number): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");

  if (mode !== undefined) {
    fs.chmodSync(filePath, mode);
  }

  return filePath;
}

function createFakeCodeServerPackage(root: string, options: {
  bin?: Record<string, string> | string;
  entryContents?: string;
  entryMode?: number;
  entryRelativePath?: string;
  includeSupportRoot?: boolean;
  main?: string;
  version?: string;
} = {}): string {
  const entryRelativePath = options.entryRelativePath ?? "out/node/entry.js";
  const packageRoot = path.join(root, "node_modules", "code-server");
  const packageJson = {
    name: "code-server",
    version: options.version ?? "4.117.0",
    ...(options.bin === undefined ? { bin: { "code-server": entryRelativePath } } : { bin: options.bin }),
    ...(options.main ? { main: options.main } : {}),
  };

  writeFile(packageRoot, "package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

  if (options.entryContents !== null) {
    writeFile(
      packageRoot,
      entryRelativePath,
      options.entryContents ?? "#!/usr/bin/env node\nconsole.log('fake code-server');\n",
      options.entryMode ?? 0o755,
    );
  }

  if (options.includeSupportRoot !== false) {
    fs.mkdirSync(path.join(packageRoot, "lib", "vscode"), { recursive: true });
  }

  return packageRoot;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not resolve a free TCP port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { closeServer, createFakeCodeServerPackage, getFreePort, sleep, tempDir, writeFile };
