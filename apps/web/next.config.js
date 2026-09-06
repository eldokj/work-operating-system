/** @type {import('next').NextConfig} */
const nextConfig = {
  // These are TypeScript-source-only workspace packages (no build step) — see
  // docs/architecture/09-folder-structure.md. Next.js needs to transpile them itself.
  transpilePackages: ["@ai-task-manager/domain", "@ai-task-manager/shared", "@ai-task-manager/db"],
  // @prisma/client ships a native query-engine binary that webpack must NOT try to bundle
  // — it needs to be resolved via plain Node `require` at runtime so Prisma's own
  // engine-locating logic finds it next to the generated client in packages/db/node_modules.
  serverExternalPackages: ["@prisma/client"],
  eslint: {
    ignoreDuringBuilds: false,
  },
};

module.exports = nextConfig;
