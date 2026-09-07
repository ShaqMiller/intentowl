/**
 * Builds the adapter registry from whatever credentials are configured.
 *
 * A source with missing credentials is simply absent from the registry rather
 * than a boot failure: HN needs no auth and must keep working while the Reddit
 * app is still awaiting approval. Attempting to poll an absent source fails
 * with a clear message at the point of use.
 */
import { createHnAdapter, createRedditAdapter } from "@intentowl/core";

import { env } from "./env.ts";
import type { AdapterRegistry } from "./jobs/poll.ts";
import { logger } from "./logger.ts";

export function createAdapters(): AdapterRegistry {
  const registry: AdapterRegistry = {
    // Free, unauthenticated, always available.
    hn: createHnAdapter(),
  };

  if (
    env.REDDIT_CLIENT_ID !== undefined &&
    env.REDDIT_CLIENT_SECRET !== undefined &&
    env.REDDIT_USER_AGENT !== undefined
  ) {
    registry.reddit = createRedditAdapter({
      credentials: {
        clientId: env.REDDIT_CLIENT_ID,
        clientSecret: env.REDDIT_CLIENT_SECRET,
        userAgent: env.REDDIT_USER_AGENT,
      },
    });
  } else {
    logger.warn(
      "reddit credentials absent; the reddit adapter is not registered",
    );
  }

  logger.info(
    { sources: Object.keys(registry).sort() },
    "adapters ready",
  );
  return registry;
}
