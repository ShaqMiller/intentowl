# Sources

What IntentOwl reads today, what it could read next, and what it must not.
Researched 25 September 2026. Figures marked *unverified* came from secondary
sources because the primary page blocked automated reading — check those in a
browser before betting on them.

## What an adapter needs

A source only earns an adapter if it has all five:

1. keyword search, or a firehose small enough to filter locally
2. incremental polling — a cursor, a `since`, or reliable newest-first order
3. no login wall and no scraping against the terms
4. terms of service that permit automated reading and commercial use
5. a public URL where the customer can reply

## Live today

| Source | Auth | Limits | Notes |
| --- | --- | --- | --- |
| Hacker News | none | Algolia, generous | Stories and comments |
| Lobsters | none | 1 req/s | Small, developer-heavy |
| Stack Exchange | optional key | 300/day, 10,000 with a free key | Best pure pain-points; CC BY-SA, see below |
| RSS | none | per feed | Any blog or forum with a feed |
| Bluesky | app password | session re-minted every 90 min | Highest yield to date |
| GitHub issues | optional token | 10 req/min, 30 with a token | "Leaving a competitor", in the repo they are leaving |

Built but switched off: **Reddit** (awaiting API approval) and **Threads**
(awaiting Meta app review). `x` exists in the source enum with no adapter.

### Yield, 7–25 September 2026

Bluesky produced 17 leads a fortnight, Hacker News 3, Lobsters and Stack
Exchange none. Almost nothing from the quiet two even reached the classifier:
0 of 543 Lobsters posts and 2 of 253 Stack Exchange posts passed the
pre-filter. That is a fit problem between a watch's terms and its sources, not
a coverage problem — adding sources does not fix it. Check this table before
adding another source.

## Rules that bind us

- **GitHub** — the acceptable use policy permits collecting through the API but
  forbids using what you collect to send unsolicited email. A digest to the
  customer is fine; emailing the issue's author is not. Never collect addresses.
  https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- **Stack Exchange** — content is CC BY-SA. Quoted snippets need attribution and
  a link back. Their data licensing terms restrict using API content to *train*
  models; ranking and summarising at inference is a grey area, so keep snippets
  short, always link, and do not accumulate a corpus.
- **Reddit** — the free tier is non-commercial (personal projects, bots, mod
  tools, research). Lead generation inside a paid product is commercial and
  reportedly needs a signed agreement, around $0.24/1,000 calls (*unverified*).
  An application scoped as a personal project is the failure mode to avoid.
- **Product Hunt** — "The Product Hunt API must not be used for commercial
  purposes." Email them before building anything.
- **Discourse** — per-forum terms. `robots.txt` on some instances disallows
  `/search`, so prefer `/posts.json` and check robots per forum at config time.

## Worth building next

| Candidate | Why | Cost | Effort |
| --- | --- | --- | --- |
| Discourse (generic) | One adapter, unlimited niche forums; `/posts.json` and `/search.json` are anonymous on public forums | free | medium, plus an allowlist per forum |
| Lemmy | `/api/v3/search`, anonymous, 100 searches/10 min per instance | free | small |
| We Work Remotely + HN "Who is hiring" | Fit the existing RSS adapter; no new code | free | none |
| Product Hunt | GraphQL, newest-first; comments are mostly congratulatory | free | small, after their permission |
| Mastodon | Since 4.2 only opted-in accounts (~8–10%) are searchable, so hashtag streams rather than search | free | medium, modest yield |

## Ruled out

- **X/Twitter** — pay per use, $0.005 per post read. About $1,500/month at
  10,000 matched posts a day.
- **LinkedIn** — no sanctioned public-post search at any tier a small company
  can reach; automated access breaches the user agreement.
- **YouTube** — no keyword search over comments, and search is capped at 100
  calls a day.
- **Nostr** — free and open, but the audience does not buy B2B SaaS.
- **G2, Capterra, Trustpilot, AlternativeTo** — no reachable API; competitor
  reviews are not available at any sane price. The third-party "review APIs"
  are scrapers and put the breach on us.
- **Discord, Slack** — both need a per-server admin install. Discord's developer
  policy prohibits mining. These are per-customer integrations at best.
- **Quora, Indie Hackers, Hashnode** — no sanctioned API, or no global search.
- **Brand24, Mention, Meltwater** — enterprise contracts, and redistribution to
  our customers is not granted. Paying a competitor to be our backend.
- **Serper and other SERP resellers** — redistribution posture unclear, with
  Google's terms underneath. Brave and Exa are usable in principle, but storing
  and redistributing snippets needs a separate rights agreement; revisit only if
  a gap-filler is genuinely needed.
