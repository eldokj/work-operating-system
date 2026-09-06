import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@ai-task-manager/db";

// The running application connects as the least-privilege `app_runtime` role, NOT the
// migration/owner role that packages/db's own singleton uses — see
// docs/architecture/14-phase1-implementation-deviations.md #4 and
// docs/architecture/12-security-strategy.md §12.7 (audit_logs immutability).
declare global {
  // eslint-disable-next-line no-var
  var __appPrisma: PrismaClient | undefined;
}

// Windows + Next.js webpack bundling loses the relative path Prisma's generated client
// normally uses to locate its native query-engine binary when the client is consumed
// from a sibling monorepo package rather than the app's own node_modules — see
// docs/architecture/14-phase1-implementation-deviations.md #6. Point Prisma at the exact
// engine file generated alongside packages/db's client. Deliberately uses process.cwd()
// rather than require.resolve()/import.meta — webpack intercepts and rewrites module
// resolution calls inside bundled code (silently breaking a require.resolve()-based
// version of this same fix, caught by the try/catch below without ever taking effect);
// process.cwd() is a plain runtime call webpack never touches, and reliably equals
// apps/web here because npm workspaces sets cwd to the package a `-w` script runs in.
// Harmless no-op on platforms/setups where the default resolution already works (the
// file simply won't exist at this path and this silently falls through).
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  try {
    const enginePath = path.join(
      process.cwd(),
      "..",
      "..",
      "packages",
      "db",
      "node_modules",
      ".prisma",
      "client",
      "query_engine-windows.dll.node"
    );
    if (existsSync(enginePath)) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath;
    }
  } catch {
    // Fall through to Prisma's default engine resolution.
  }
}

export const db: PrismaClient =
  global.__appPrisma ??
  new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL },
    },
  });

if (process.env.NODE_ENV !== "production") {
  global.__appPrisma = db;
}
