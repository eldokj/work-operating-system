// Spins up a real production build of apps/web on a scratch port so the E2E suite drives
// the actual HTTP API end-to-end (route handlers -> domain services -> Prisma -> Postgres)
// against docs/architecture's approved local Postgres, per doc 11 §11.3. Requires
// `next build` to have already run (apps/web's `test:e2e` npm script does this).
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export const E2E_PORT = 3799;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

let server: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

export async function setup(): Promise<void> {
  const appsWebDir = path.resolve(__dirname, "../../apps/web");
  // Resolved from apps/web's own node_modules — bypasses npm/npx shell wrapping so
  // `server.kill()` at teardown actually terminates the real Next.js process (not just a
  // shell that spawned it), which npm/npx-via-shell would not reliably do on Windows.
  const nextBin = require.resolve("next/dist/bin/next", { paths: [appsWebDir] });

  server = spawn(process.execPath, [nextBin, "start", "-p", String(E2E_PORT)], {
    cwd: appsWebDir,
    stdio: "pipe",
    env: process.env,
  });

  let output = "";
  server.stdout?.on("data", (d) => (output += d.toString()));
  server.stderr?.on("data", (d) => (output += d.toString()));

  try {
    await waitForServer(E2E_BASE_URL, 30_000);
  } catch (err) {
    console.error("E2E server failed to start. Output so far:\n" + output);
    throw err;
  }
}

export async function teardown(): Promise<void> {
  if (server && !server.killed) {
    server.kill();
  }
}
