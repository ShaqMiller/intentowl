# Reddit Data API access request — draft

Status: **draft, not submitted.** Everything below describes how IntentOwl
actually uses Reddit today (`packages/core/adapters/reddit.ts`,
`apps/worker/src/jobs/retention.ts`). If the code changes, change this.

## Before submitting

1. **Deploy the privacy policy** so `https://intentowl.com/privacy` loads.
2. **Set a real `REDDIT_USER_AGENT`.** `.env` still has the placeholder
   `(by /u/your-reddit-username)`. Reddit's required format is
   `<platform>:<app id>:<version> (by /u/<username>)`, for example
   `web:com.intentowl.worker:v0.1 (by /u/YOUR_USERNAME)`. Use the Reddit
   account that owns the request.
3. **Submit** from the Reddit account that will own the app: Reddit Help →
   Data API Wiki → "contact us" / request form → choose **Developer** and
   describe the use case. Under the Responsible Builder Policy (updated
   5 June 2026) access is approved manually, can take 2–4 weeks, and commercial
   use needs explicit written approval — so say plainly that it is commercial.
4. After approval, register the app at `reddit.com/prefs/apps` if Reddit asks
   for it, and put `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` and
   `REDDIT_USER_AGENT` in Railway. The worker registers the Reddit adapter as
   soon as all three are present.

## Draft answers

**What are you building?**

IntentOwl is a small subscription tool for founders of early-stage software
products. Each customer describes their product and a few search terms; once a
day we email them a short list of recent public posts where someone describes
the problem their product solves — for example "I launched a month ago and have
zero paying customers" — with a link back to the original post. The founder
reads it and decides whether to reply, by hand, on Reddit.

**Is it commercial?**

Yes. Customers pay $15 or $39 a month. We are applying for commercial use
explicitly rather than describing it as a personal project.

**What access do you need?**

Read-only, application-only OAuth (client credentials). No user logins, no
posting, commenting, voting, messaging or moderation — the app never writes to
Reddit. Endpoints:

- `GET /r/{subreddits}/new?limit=100&before={fullname}` — new posts in the
  subreddits a customer chose.
- `GET /r/{subreddits}/search?q={terms}&sort=new&t=week&restrict_sr=true`
  (or `/search` when a customer lists no subreddits) — one keyword search per
  poll.

**How much traffic?**

- At most 24 requests per poll per customer search, one poll every 12 minutes.
- A client-wide limiter caps the whole application at 60 requests per minute,
  under the free tier's 100 per minute, shared across every customer.
- A 429 stops the poll and reschedules it rather than retrying.
- Today there is one internal search; we expect fewer than ten customers in
  the first months.

**What data do you store, and for how long?**

For each matching post: its id, subreddit, title, body text, author username,
permalink, creation time, score and comment count. Posts are **deleted 30 days
after collection** by a daily job. Customer account data is separate and never
combined with Reddit data beyond linking a post to the customer search it
matched.

**How is it shown?**

Only to the paying customer whose search matched the post: the post's title,
a one-sentence reason it is relevant (written by our classifier), and a link to
the post on Reddit. We do not republish post bodies, build datasets, profile
authors, sell or share data, or use it for advertising.

**Do you use Reddit data with AI or machine learning?**

We do not train models on Reddit data. To decide whether a post is relevant to
a customer's product, its title and text are sent to Anthropic's commercial
Claude API, which returns a relevance verdict. That is inference, not training;
nothing is fine-tuned or retained by us for training.

> Verify before sending: if Reddit asks whether the model provider trains on
> the data, check Anthropic's current commercial terms and quote them, rather
> than relying on this sentence.

**Privacy policy:** https://intentowl.com/privacy
**Contact:** tools@intentowl.com

## If it is rejected

Reddit states small commercial projects are often declined without a reason.
Do not fall back to Reddit's `.rss` feeds: they still load, but using the data
commercially without approval breaks Reddit's terms, and the product that
this one replaces died of platform access. Hacker News, Bluesky and (once
approved) Threads carry on regardless.
