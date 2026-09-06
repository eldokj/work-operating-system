import { PrismaClient } from "@prisma/client";

// Standard Next.js-safe Prisma singleton (avoids exhausting connections on hot reload).
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Lazily realized so that merely IMPORTING this module (e.g. `apps/web` pulling in the
 * `PrismaClient` class re-export below to construct its own differently-configured
 * instance — see docs/architecture/14-phase1-implementation-deviations.md #6) never
 * triggers construction as a side effect. Constructing a PrismaClient loads its native
 * query engine; doing that unconditionally on import previously caused a build-time crash
 * under Next.js/webpack even though nothing in the app actually used this export.
 */
function getPrisma(): PrismaClient {
  if (!global.__prisma) {
    global.__prisma = createClient();
  }
  return global.__prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma() as object, prop, receiver);
  },
});

export * from "@prisma/client";
