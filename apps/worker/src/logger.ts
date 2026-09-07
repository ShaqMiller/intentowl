import { pino } from "pino";

import { env } from "./env.ts";

/**
 * Structured JSON logs (ARCHITECTURE.md section 4.9). Railway ingests the JSON
 * directly; locally we pipe through pino-pretty for readability.
 *
 * Child loggers must carry `customer_id` / `watch_id` wherever they are known.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "worker" },
  redact: {
    paths: [
      "DATABASE_URL",
      "*.DATABASE_URL",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
    ],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
