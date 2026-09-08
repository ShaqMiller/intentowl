/**
 * Builds the adapter registry from whatever credentials are configured.
 *
 * A source with missing credentials is simply absent from the registry rather
 * than a boot failure: HN needs no auth and must keep working while the Reddit
 * app is still awaiting approval. Attempting to poll an absent source fails
 * with a clear message at the point of use.
 */
import {
  createBlueskyAdapter,
  createHnAdapter,
  createLobstersAdapter,
  createRedditAdapter,
  createRssAdapter,
  createStackExchangeAdapter,
} from "@intentowl/core";

import { env } from "./env.ts";
import type { AdapterRegistry } from "./jobs/poll.ts";
import { logger } from "./logger.ts";

export function createAdapters(): AdapterRegistry {
  const registry: AdapterRegistry = {
    // Free and unauthenticated, so always available.
    hn: createHnAdapter(),
    lobsters: createLobstersAdapter(),
    // Works without a key at 300 requests/day per IP; the key raises it to
    // 10,000 and is worth having before a second customer.
    stackexchange: createStackExchangeAdapter(
      env.STACKEXCHANGE_KEY === undefined ? {} : { apiKey: env.STACKEXCHANGE_KEY },
    ),
    // Feeds are per-watch configuration, not credentials, so RSS is always
    // available; a watch with no feeds fails at the point of use with a clear
    // message rather than being silently absent here.
    rss: createRssAdapter(),
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

  if (
    env.BLUESKY_IDENTIFIER !== undefined &&
    env.BLUESKY_APP_PASSWORD !== undefined
  ) {
    // Registered but unproven: this adapter has never completed a live poll.
    // See the header of adapters/bluesky.ts before trusting its output.
    registry.bluesky = createBlueskyAdapter({
      credentials: {
        identifier: env.BLUESKY_IDENTIFIER,
        appPassword: env.BLUESKY_APP_PASSWORD,
      },
    });
    logger.warn(
      "bluesky adapter registered but has never run against the live API",
    );
  } else {
    logger.warn(
      "bluesky credentials absent; the bluesky adapter is not registered",
    );
  }

  logger.info(
    { sources: Object.keys(registry).sort() },
    "adapters ready",
  );
  return registry;
}
