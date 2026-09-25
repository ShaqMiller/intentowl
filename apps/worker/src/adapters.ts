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
  createGithubAdapter,
  createHnAdapter,
  createLobstersAdapter,
  createRedditAdapter,
  createRssAdapter,
  createStackExchangeAdapter,
  createThreadsAdapter,
} from "@intentowl/core";
import type { Db } from "@intentowl/db";

import { env } from "./env.ts";
import type { AdapterRegistry } from "./jobs/poll.ts";
import { currentThreadsToken } from "./jobs/threads-token.ts";
import { logger } from "./logger.ts";

/**
 * `db` is optional so the CLI can build adapters without a connection. Without
 * it, Threads uses the env token as-is and never sees a refreshed one.
 */
export function createAdapters(db?: Db): AdapterRegistry {
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
    // Public issue search needs no auth. A token only raises the rate limit,
    // so this is registered either way.
    github: createGithubAdapter(
      env.GITHUB_TOKEN === undefined ? {} : { token: env.GITHUB_TOKEN },
    ),
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
    registry.bluesky = createBlueskyAdapter({
      credentials: {
        identifier: env.BLUESKY_IDENTIFIER,
        appPassword: env.BLUESKY_APP_PASSWORD,
      },
    });
  } else {
    logger.warn(
      "bluesky credentials absent; the bluesky adapter is not registered",
    );
  }

  const threadsToken = env.THREADS_ACCESS_TOKEN;
  if (threadsToken !== undefined) {
    registry.threads = createThreadsAdapter({
      getAccessToken: () =>
        db === undefined
          ? Promise.resolve(threadsToken)
          : currentThreadsToken(db, threadsToken),
    });
  } else {
    logger.warn(
      "threads token absent; the threads adapter is not registered",
    );
  }

  logger.info(
    { sources: Object.keys(registry).sort() },
    "adapters ready",
  );
  return registry;
}
