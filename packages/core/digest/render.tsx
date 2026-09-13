/**
 * The digest email (ARCHITECTURE.md section 4.5).
 *
 * This is the product. Everything upstream — adapters, filter, classifier,
 * ranking — exists so that this arrives at 7am and is worth reading. The bar
 * the milestone sets is "looks like something worth $49", which in practice
 * means: scannable in fifteen seconds, every lead one click from a reply, and
 * no filler.
 *
 * Email HTML is not web HTML. Tables and inline styles, no flexbox, no grid,
 * no external stylesheet — Outlook and Gmail will discard all of it. React
 * Email exists to make that bearable, not to make it go away.
 */
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

import { leadHeadline, type DigestGroup, type RankedLead } from "../scoring.ts";

export interface DigestEmailProps {
  customerName: string;
  groups: DigestGroup[];
  /** Local date string for the customer, e.g. "Monday 7 September". */
  dateLabel: string;
  /** Base URL for feedback links. */
  appUrl: string;
  /** Signed token per item, so a feedback link cannot be forged or guessed. */
  feedbackToken?: (itemId: string) => string;
  /**
   * Set when a source or the classifier was degraded. The digest still sends —
   * silence is the one unacceptable failure — but it says so plainly rather
   * than quietly looking like a thin day.
   */
  degradedNote?: string | null;
  totalScanned?: number;
}

// Email clients ignore stylesheets, so the palette lives here as constants.
const INK = "#131A20";
const SOFT = "#3D4A55";
const MUTED = "#5F6E7A";
const FAINT = "#8695A1";
const LINE = "#DDE3E8";
const ACCENT = "#0E6E78";
const GROUND = "#F4F6F7";
const SURFACE = "#FFFFFF";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function DigestEmail({
  customerName,
  groups,
  dateLabel,
  appUrl,
  feedbackToken,
  degradedNote,
  totalScanned,
}: DigestEmailProps) {
  const count = groups.reduce((n, g) => n + g.leads.length, 0);

  return (
    <Html lang="en">
      <Head />
      {/* The inbox preview line. Worth as much as the subject for open rate. */}
      <Preview>
        {count === 0
          ? `No new leads today — ${dateLabel}`
          : `${count} lead${count === 1 ? "" : "s"} — ${topTitle(groups)}`}
      </Preview>
      <Body style={{ backgroundColor: GROUND, margin: 0, padding: "24px 0", fontFamily: FONT }}>
        <Container
          style={{
            backgroundColor: SURFACE,
            maxWidth: "620px",
            margin: "0 auto",
            borderRadius: "8px",
            border: `1px solid ${LINE}`,
            overflow: "hidden",
          }}
        >
          <Section style={{ padding: "24px 28px 4px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "11px",
                letterSpacing: "1.4px",
                textTransform: "uppercase",
                color: ACCENT,
                fontWeight: 600,
              }}
            >
              IntentOwl · {dateLabel}
            </Text>
            <Text style={{ margin: "8px 0 0", fontSize: "22px", fontWeight: 700, color: INK, lineHeight: 1.25 }}>
              {count === 0
                ? "No new leads today"
                : `${count} lead${count === 1 ? "" : "s"} for ${customerName}`}
            </Text>
            {totalScanned !== undefined && count > 0 && (
              <Text style={{ margin: "6px 0 0", fontSize: "13px", color: MUTED }}>
                From {totalScanned.toLocaleString()} post
                {totalScanned === 1 ? "" : "s"} scanned since yesterday.
              </Text>
            )}
          </Section>

          {degradedNote != null && degradedNote !== "" && (
            <Section style={{ padding: "12px 28px 0" }}>
              <Text
                style={{
                  margin: 0,
                  padding: "10px 12px",
                  fontSize: "13px",
                  color: "#7A4E08",
                  backgroundColor: "#FDF4E3",
                  border: "1px solid #F0DCB4",
                  borderRadius: "5px",
                }}
              >
                {degradedNote}
              </Text>
            </Section>
          )}

          {count === 0 ? (
            <Section style={{ padding: "18px 28px 28px" }}>
              <Text style={{ margin: 0, fontSize: "14.5px", color: SOFT, lineHeight: 1.6 }}>
                Nothing crossed the bar today. That happens — a quiet day is a
                real signal, not a broken pipeline. Your watches ran normally and
                we will be back tomorrow morning.
              </Text>
            </Section>
          ) : (
            groups.map((group, gi) => (
              <Section key={group.intent} style={{ padding: gi === 0 ? "20px 28px 0" : "8px 28px 0" }}>
                <Text
                  style={{
                    margin: "0 0 2px",
                    fontSize: "11px",
                    letterSpacing: "1.2px",
                    textTransform: "uppercase",
                    color: FAINT,
                    fontWeight: 600,
                  }}
                >
                  {group.label} · {group.leads.length}
                </Text>
                {group.leads.map((leadItem) => (
                  <LeadBlock
                    key={leadItem.itemId}
                    lead={leadItem}
                    appUrl={appUrl}
                    {...(feedbackToken ? { feedbackToken } : {})}
                  />
                ))}
              </Section>
            ))
          )}

          <Section style={{ padding: "8px 28px 24px" }}>
            <Hr style={{ borderColor: LINE, margin: "12px 0 14px" }} />
            <Text style={{ margin: 0, fontSize: "12px", color: FAINT, lineHeight: 1.6 }}>
              Reply angles are suggestions for you to write from, never messages
              to paste. IntentOwl never posts anything on your behalf.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function LeadBlock({
  lead,
  appUrl,
  feedbackToken,
}: {
  lead: RankedLead;
  appUrl: string;
  feedbackToken?: (itemId: string) => string;
}) {
  const token = feedbackToken?.(lead.itemId);
  return (
    <Section
      style={{
        padding: "14px 0 4px",
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      <Text style={{ margin: "0 0 3px", fontSize: "12px", color: FAINT }}>
        {lead.venue ?? "unknown"}
        {lead.author != null && ` · ${lead.author}`}
        {" · "}
        <span style={{ color: scoreColour(lead.score) }}>{lead.score}</span>
      </Text>

      <Text style={{ margin: "0 0 6px", fontSize: "16px", lineHeight: 1.35, fontWeight: 600 }}>
        <Link href={lead.url} style={{ color: INK, textDecoration: "none" }}>
          {leadHeadline(lead)}
        </Link>
      </Text>

      {lead.reason != null && (
        <Text style={{ margin: "0 0 8px", fontSize: "14px", color: SOFT, lineHeight: 1.55 }}>
          {lead.reason}
        </Text>
      )}

      {lead.replyAngle != null && lead.replyAngle !== "" && (
        <Text
          style={{
            margin: "0 0 8px",
            padding: "9px 12px",
            fontSize: "13.5px",
            color: SOFT,
            backgroundColor: GROUND,
            borderLeft: `3px solid ${ACCENT}`,
            borderRadius: "0 4px 4px 0",
            lineHeight: 1.55,
          }}
        >
          <span style={{ color: ACCENT, fontWeight: 600 }}>Angle · </span>
          {lead.replyAngle}
        </Text>
      )}

      <Text style={{ margin: "0 0 10px", fontSize: "12.5px" }}>
        <Link href={lead.url} style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>
          Open thread →
        </Link>
        {lead.duplicates.length > 0 && (
          <span style={{ color: FAINT }}>
            {"  ·  also in "}
            {lead.duplicates.map((d, i) => (
              <React.Fragment key={d.url}>
                {i > 0 && ", "}
                <Link href={d.url} style={{ color: MUTED }}>
                  {d.venue ?? "elsewhere"}
                </Link>
              </React.Fragment>
            ))}
          </span>
        )}
        {token !== undefined && (
          <span style={{ color: FAINT, float: "right" }}>
            <Link href={`${appUrl}/f/${token}/up`} style={{ color: FAINT, textDecoration: "none" }}>
              Good lead
            </Link>
            {" · "}
            <Link href={`${appUrl}/f/${token}/down`} style={{ color: FAINT, textDecoration: "none" }}>
              Not for me
            </Link>
          </span>
        )}
      </Text>
    </Section>
  );
}

function scoreColour(score: number): string {
  if (score >= 85) return "#2E7D53";
  if (score >= 70) return "#0E6E78";
  return MUTED;
}

function topTitle(groups: readonly DigestGroup[]): string {
  const first = groups[0]?.leads[0];
  // Not `first.title`: a Bluesky post has none, so the inbox preview read
  // "7 leads — " followed by nothing. leadHeadline truncates on its own.
  return first === undefined ? "" : leadHeadline(first, 68);
}

/** Subject line. Concrete beats clever — it competes in a crowded inbox. */
export function digestSubject(groups: readonly DigestGroup[], dateLabel: string): string {
  const count = groups.reduce((n, g) => n + g.leads.length, 0);
  if (count === 0) return `IntentOwl · no new leads · ${dateLabel}`;
  const buying = groups.find((g) => g.intent === "buying_intent")?.leads.length ?? 0;
  if (buying > 0) {
    return `${count} lead${count === 1 ? "" : "s"}, ${buying} actively shopping · ${dateLabel}`;
  }
  return `${count} lead${count === 1 ? "" : "s"} · ${dateLabel}`;
}
