# Threads source — setup

Status: **code built and tested against Meta's documented responses; not yet
connected.** The adapter (`packages/core/adapters/threads.ts`) registers only
when `THREADS_ACCESS_TOKEN` is set, and Threads stays under "awaiting Meta
approval" in the search form until the first real poll has been checked.

## How it works

- Meta's official keyword search, `GET graph.threads.net/v1.0/keyword_search`,
  newest posts first, from the last poll forward. Hourly per search.
- **Budget:** 2,200 searches per rolling 24 hours per Threads account, across
  every app. All customers share the one token, so the adapter budgets 2,000 a
  day and stops a poll with a warning when it runs out.
- **Token:** long-lived tokens last 60 days and can only be refreshed while
  valid. A daily job refreshes it weekly and stores the result in
  `source_tokens`; `THREADS_ACCESS_TOKEN` only seeds it. If refreshing an
  established token fails, the job fails and the ops alert fires.

## 1. Create the Meta app

1. Go to https://developers.facebook.com → **My Apps → Create app**.
2. Choose the use case **"Access the Threads API"**.
3. Permissions: **threads_basic** and **threads_keyword_search**.
4. App settings:
   - Privacy policy URL: `https://intentowl.com/privacy`
   - Data deletion instructions URL: `https://intentowl.com/privacy#deletion`
   - App icon and category (Business / Productivity).
5. Add your own Threads account as a **Threads tester** in the app's roles, then
   accept the invite from the Threads account's settings.

Meta may ask for business verification before approving advanced access.

## 2. Get a long-lived token

1. Generate a user access token for your tester account with both permissions
   — from the Threads use case's token generator in the app dashboard, or
   through the OAuth flow.
2. Exchange the short-lived token (valid one hour) for a long-lived one
   (60 days):

   ```
   GET https://graph.threads.net/access_token
     ?grant_type=th_exchange_token
     &client_secret=<APP_SECRET>
     &access_token=<SHORT_LIVED_TOKEN>
   ```

3. Put the long-lived token in `.env` and in Railway as `THREADS_ACCESS_TOKEN`.
   Never paste it into chat.

The first daily token check will try to refresh it and, because it is under a
day old, Meta refuses; the job records that and retries the next day. That is
expected.

## 3. Test before approval — carefully

Until `threads_keyword_search` is approved, search **only returns your own
posts**, and it does so without any error. So:

1. Post a thread from the tester account containing one of the search's terms,
   e.g. "zero paying customers".
2. Run a poll: `pnpm --filter worker cli run-poll --watch=<id> --source=threads`.
3. It should fetch that one post. If it fetches nothing, the token or the
   permissions are wrong — fix that before submitting for review.

## 4. Submit for App Review

Request **threads_keyword_search**. Suggested description:

> IntentOwl helps founders of small software products find public posts where
> people describe a problem the founder's product solves. We use keyword search
> to find recent public Threads posts matching a customer's search terms,
> classify whether each is relevant, and show the customer the post's first
> line, a one-sentence reason and a link to the post on Threads, in a daily
> email. We never publish, reply, like or message on anyone's behalf; the
> founder decides whether to reply themselves on Threads. Keyword search is the
> only permission used beyond threads_basic, and it is read-only.

Screencast (Meta requires one per permission). Record:

1. The IntentOwl dashboard search editor with its search terms.
2. The test post from step 3 arriving as a lead on the dashboard, with its
   reason and "Open thread" link opening the post on Threads.
3. The privacy policy page.

## 5. After approval

Tell Claude, which will:

1. Run one poll and compare the real response with the adapter's schema and
   test fixtures — the adapter has only met documented responses so far.
2. Move Threads from "awaiting Meta approval" to the live sources in the search
   form, and onto the landing page's source list only once it is really polling.
3. Tick Threads on the IntentOwl search.
