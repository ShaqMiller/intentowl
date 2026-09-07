import { loadRootEnv } from "@intentowl/core/env";
import type { NextConfig } from "next";

// One .env at the repo root serves every workspace, so pull it in before Next
// snapshots the environment.
loadRootEnv();

const nextConfig: NextConfig = {
  // packages/* are consumed as TypeScript source, with no build step.
  transpilePackages: ["@intentowl/core", "@intentowl/db"],
  typedRoutes: true,
};

export default nextConfig;
