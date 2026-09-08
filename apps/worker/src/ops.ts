/**
 * Operator notifications (ARCHITECTURE.md section 10).
 *
 * The pipeline's failure mode is silence: a poller that stops, a classifier
 * that 429s, a digest that never sends. Nothing about that is visible from the
 * outside until a customer notices they got no email — which is exactly the
 * moment you did not want to find out.
 *
 * So every alert goes through here, and every alert is also logged. Slack is
 * best-effort: a webhook outage must never take down the job that was trying
 * to report through it, which is why nothing here throws.
 */
import { postSlack } from "@intentowl/core";

import { env } from "./env.ts";
import { logger } from "./logger.ts";

export type OpsLevel = "info" | "warn" | "error";

const ICON: Record<OpsLevel, string> = {
  info: ":white_check_mark:",
  warn: ":warning:",
  error: ":rotating_light:",
};

export interface OpsMessage {
  level: OpsLevel;
  title: string;
  /** Rendered as one Slack line each, and joined into the log message. */
  lines?: string[];
}

/**
 * Send an operator notification. Never throws, never rejects.
 */
export async function notifyOps(message: OpsMessage): Promise<void> {
  const { level, title, lines = [] } = message;

  const log = logger.child({ ops: true });
  const body = lines.length === 0 ? title : `${title} — ${lines.join("; ")}`;
  if (level === "error") log.error(body);
  else if (level === "warn") log.warn(body);
  else log.info(body);

  const webhook = env.OPS_SLACK_WEBHOOK_URL;
  if (webhook === undefined) return;

  const text = `${ICON[level]} *${title}*`;
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text } },
  ];
  if (lines.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.map((l) => `• ${l}`).join("\n") },
    });
  }

  try {
    const result = await postSlack(webhook, { text, blocks });
    if (!result.ok) {
      // Log it, but do not escalate: the caller is usually already reporting a
      // failure, and a failure to report a failure must not become the error.
      log.warn({ err: result.error }, "ops slack post failed");
    }
  } catch (error) {
    log.warn({ err: error }, "ops slack post threw");
  }
}

/**
 * Wrap a job handler so an unhandled failure reaches the operator before
 * pg-boss retries it.
 *
 * Rethrows after notifying — pg-boss's retry and dead-letter handling is the
 * recovery mechanism, and swallowing the error here would quietly mark a
 * failed job complete.
 */
export function withOpsAlert<T extends unknown[]>(
  jobName: string,
  handler: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await notifyOps({
        level: "error",
        title: `Job failed: ${jobName}`,
        lines: [detail],
      });
      throw error;
    }
  };
}
