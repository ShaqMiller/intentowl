import { loadRootEnv } from "@intentowl/core/env";
import type { NextConfig } from "next";

// One .env at the repo root serves every workspace, so pull it in before Next
// snapshots the environment.
loadRootEnv();

const nextConfig: NextConfig = {
  // packages/* are consumed as TypeScript source, with no build step.
  transpilePackages: ["@intentowl/core", "@intentowl/db"],
  typedRoutes: true,

  /**
   * Lets a verification build write somewhere other than `.next`.
   *
   * `next build` and `next dev` share that directory, so building while a dev
   * server is running replaces the chunks it is serving and breaks it with a
   * "Cannot find module ./NNN.js" that looks nothing like its cause. Set
   * NEXT_DIST_DIR to check a build without disturbing anyone.
   */
  ...(process.env["NEXT_DIST_DIR"] === undefined
    ? {}
    : { distDir: process.env["NEXT_DIST_DIR"] }),

  /**
   * Inlined so the middleware can read them.
   *
   * Middleware runs in the Edge runtime, which has no filesystem — so it
   * cannot call `loadRootEnv()`, which walks up the tree looking for the
   * repo-root .env. Next only auto-loads a .env next to the app, and this
   * monorepo deliberately keeps one at the root, so these two are handed
   * across explicitly.
   *
   * Both are safe to inline: the anon key is designed to ship to browsers,
   * and row-level security is what actually protects the data. Never add the
   * service-role key here.
   */
  env: {
    SUPABASE_URL: process.env["SUPABASE_URL"] ?? "",
    SUPABASE_ANON_KEY: process.env["SUPABASE_ANON_KEY"] ?? "",
  },
};

export default nextConfig;
