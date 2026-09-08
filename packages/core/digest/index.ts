/**
 * Digest rendering and delivery (ARCHITECTURE.md section 4.5).
 *
 * One set of ranked leads renders into three shapes — HTML email, a plain-text
 * fallback, and a Slack Block Kit payload — from the same data, so the channels
 * cannot disagree about what today's leads were.
 */
import { render } from "@react-email/render";
import * as React from "react";
import { Resend } from "resend";

import type { DigestGroup } from "../scoring.ts";
import { DigestEmail, digestSubject, type DigestEmailProps } from "./render.tsx";

export { DigestEmail, digestSubject } from "./render.tsx";
export type { DigestEmailProps } from "./render.tsx";

export interface RenderedDigest {
  subject: string;
  html: string;
  /** Plain-text alternative. Some clients show it; spam filters expect it. */
  text: string;
  leadCount: number;
}

export async function renderDigest(
  props: DigestEmailProps,
): Promise<RenderedDigest> {
  const element = React.createElement(DigestEmail, props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return {
    subject: digestSubject(props.groups, props.dateLabel),
    html,
    text,
    leadCount: props.groups.reduce((n, g) => n + g.leads.length, 0),
  };
}

// --- email ------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  /** Provider message id, when it accepted the send. */
  id?: string;
  error?: string;
}

export interface SendEmailOptions {
  apiKey: string;
  from: string;
  to: string;
  digest: RenderedDigest;
  replyTo?: string;
}

/**
 * Send through Resend.
 *
 * Returns a result rather than throwing: the caller has already written the
 * `digests` row and needs to record the outcome either way. A send that fails
 * loudly in the logs is recoverable; one that throws mid-job and loses the
 * record of what was attempted is not.
 */
export async function sendDigestEmail(
  options: SendEmailOptions,
): Promise<SendResult> {
  const resend = new Resend(options.apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: options.from,
      to: options.to,
      subject: options.digest.subject,
      html: options.digest.html,
      text: options.digest.text,
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
    });
    if (error !== null) {
      return { ok: false, error: `${error.name}: ${error.message}` };
    }
    return data?.id === undefined ? { ok: true } : { ok: true, id: data.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- slack ------------------------------------------------------------------

/**
 * The same digest as Block Kit.
 *
 * An incoming-webhook URL the customer pastes in — no OAuth app in the MVP, per
 * section 4.5. Slack renders at most 50 blocks, so the digest is capped well
 * under that.
 */
export function renderSlackBlocks(
  groups: readonly DigestGroup[],
  options: { customerName: string; dateLabel: string; degradedNote?: string | null },
): { text: string; blocks: unknown[] } {
  const count = groups.reduce((n, g) => n + g.leads.length, 0);
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text:
          count === 0
            ? `No new leads · ${options.dateLabel}`
            : `${count} lead${count === 1 ? "" : "s"} · ${options.dateLabel}`,
      },
    },
  ];

  if (options.degradedNote != null && options.degradedNote !== "") {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `:warning: ${options.degradedNote}` }],
    });
  }

  for (const group of groups) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `*${group.label}* · ${group.leads.length}` }],
    });
    for (const lead of group.leads) {
      const parts = [`*<${lead.url}|${escapeSlack(lead.title ?? "(untitled)")}>*`];
      if (lead.reason != null) parts.push(escapeSlack(lead.reason));
      if (lead.replyAngle != null && lead.replyAngle !== "") {
        parts.push(`_Angle:_ ${escapeSlack(lead.replyAngle)}`);
      }
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: parts.join("\n") },
      });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${lead.venue ?? "unknown"}${lead.author != null ? ` · ${lead.author}` : ""} · score ${lead.score}`,
          },
        ],
      });
    }
  }

  return {
    // Fallback for notifications and clients that cannot render blocks.
    text:
      count === 0
        ? `IntentOwl: no new leads today for ${options.customerName}.`
        : `IntentOwl: ${count} lead${count === 1 ? "" : "s"} for ${options.customerName}.`,
    blocks: blocks.slice(0, 48),
  };
}

export async function postSlackDigest(
  webhookUrl: string,
  payload: { text: string; blocks: unknown[] },
): Promise<SendResult> {
  return postSlack(webhookUrl, payload);
}

/**
 * Post any message to a Slack incoming webhook.
 *
 * The digest is one caller; the ops report is another. Failure is returned
 * rather than thrown — a Slack outage must never take down the job that was
 * trying to report through it.
 */
export async function postSlack(
  webhookUrl: string,
  payload: { text: string; blocks?: unknown[] },
): Promise<SendResult> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { ok: false, error: `slack webhook returned ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Slack mrkdwn treats these three characters as markup. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
