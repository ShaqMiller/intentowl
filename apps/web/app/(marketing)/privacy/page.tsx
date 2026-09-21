/**
 * Privacy policy.
 *
 * Required by Reddit's and Meta's API access reviews, and owed to customers
 * regardless. Every statement here has to be true of the running system — the
 * processors are the services actually wired in, the retention numbers match
 * `apps/worker/src/jobs/retention.ts`, and "no analytics" is true because the
 * web app loads none. Change the code and this page together.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What IntentOwl collects, why, who processes it, and how to have it deleted.",
};

const CONTACT = "tools@intentowl.com";

export default function PrivacyPage() {
  return (
    <main className="prose legal">
      <p className="eyebrow">Last updated 14 September 2026</p>
      <h1>Privacy policy</h1>
      <p>
        IntentOwl finds public posts where people describe a problem a
        customer&apos;s product solves, and emails that customer a ranked digest.
        This page explains what data that involves, what we do with it, and how
        to have it deleted. Questions go to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>Two kinds of data</h2>
      <p>
        <b>Customer data</b> is what you give us when you sign up and use
        IntentOwl. <b>Public post data</b> is what we read from public
        communities to find leads for customers. They are handled differently,
        so they are described separately.
      </p>

      <h2>Customer data</h2>
      <ul>
        <li>
          <b>Account:</b> your email address, name, timezone and preferred digest
          time. Sign-in is handled by Supabase Auth; we never see or store your
          password in readable form.
        </li>
        <li>
          <b>Billing:</b> your plan and a Stripe customer reference. Card details
          are entered on Stripe&apos;s checkout and never reach our servers.
        </li>
        <li>
          <b>What you tell us about your product:</b> your product description,
          ideal customer, competitors, disqualifiers and search terms. This is
          what posts are judged against.
        </li>
        <li>
          <b>Activity:</b> the digests we sent you, which leads were in them, and
          any &ldquo;Good lead&rdquo; or &ldquo;Not for me&rdquo; ratings you give.
          Ratings are used to tune your own results and nobody else&apos;s.
        </li>
      </ul>
      <p>
        We use customer data only to run the service for you: finding and
        ranking leads, sending your digest, billing, and replying when you
        contact us. We do not sell it, share it for advertising, or use it for
        anything else.
      </p>

      <h2>Public post data</h2>
      <p>
        We read publicly available posts from Hacker News, Lobsters, Stack
        Exchange, Bluesky, RSS feeds a customer chooses, and — once each has
        approved our access — Reddit and Threads. For a post that matches a
        customer&apos;s search terms we store its text and title, link, author
        username, community, time posted, and public engagement counts such as
        replies or points.
      </p>
      <ul>
        <li>
          Posts are used only to decide whether they are relevant to a
          customer&apos;s search, and to show that customer the post&apos;s
          title, a one-line reason, and a link back to the original.
        </li>
        <li>We never post, reply, vote or send messages on any platform.</li>
        <li>
          We do not sell post data, publish it as a dataset, use it for
          advertising, or build profiles of the people who wrote it.
        </li>
        <li>
          We do not use post data to train AI models. To judge relevance, post
          text is sent to Anthropic&apos;s API, which processes it to return a
          verdict.
        </li>
      </ul>

      <h2>Who processes data for us</h2>
      <ul>
        <li><b>Supabase</b> — database and sign-in</li>
        <li><b>Vercel</b> — hosting for this website</li>
        <li><b>Railway</b> — the background service that reads sources and sends digests</li>
        <li><b>Stripe</b> — payments</li>
        <li><b>Resend</b> — email delivery</li>
        <li><b>Anthropic</b> — AI classification of posts</li>
        <li><b>Cloudflare</b> — DNS and email routing</li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We set only the cookies needed to keep you signed in. There are no
        analytics, advertising or tracking scripts on this site.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          <b>Customer data</b> is kept while your account is open. If you close
          it and ask us to delete it, we delete it within 30 days, except records
          we must keep for tax and accounting, which Stripe holds.
        </li>
        <li>
          <b>Reddit posts</b> are deleted 30 days after we collect them.
        </li>
        <li>
          <b>Other public posts</b> are kept while they are useful for showing
          customers their lead history, and deleted on request.
        </li>
      </ul>

      <h2 id="deletion">Deleting your data</h2>
      <p>
        <b>Customers:</b> email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from
        the address on your account and ask for your account to be deleted. We
        confirm by reply and delete your account, searches, ratings and digest
        history within 30 days.
      </p>
      <p>
        <b>If you wrote a post we stored</b>, on any platform, email{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with a link to the post or
        your username, and we delete what we hold within 30 days. If you delete
        a post on the original platform, you can ask us to remove our copy the
        same way.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data we hold about you, correct it, or have it
        deleted, by emailing <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We
        reply within 30 days.
      </p>

      <h2>Children</h2>
      <p>IntentOwl is a business tool and is not intended for anyone under 16.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, we update the date at the
        top and tell customers in their digest.
      </p>
    </main>
  );
}
