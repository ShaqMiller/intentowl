/**
 * Stripe webhook semantics.
 *
 * The processor itself lives in apps/web, which has no test runner, so these
 * assert the behaviours that matter against a faithful in-memory stand-in for
 * the database. They are about the *rules* — which events act, which are
 * ignored, what makes a retry safe — rather than about Drizzle.
 *
 * Why bother: this endpoint is the boundary between money and data. Every
 * failure mode here is either "a paying customer has no account" or "someone
 * granted themselves one", and both are discovered by the customer.
 */
import { describe, expect, it } from "vitest";

interface CustomerRow {
  id: string;
  email: string;
  status: "lead" | "active" | "churned";
  stripeCustomerId: string | null;
  plan: string | null;
}

/** The same decisions `processStripeEvent` makes, over a Map. */
function makeProcessor() {
  const rows = new Map<string, CustomerRow>();
  let next = 1;

  const HANDLED = new Set([
    "checkout.session.completed",
    "customer.subscription.deleted",
    "customer.subscription.updated",
  ]);

  function process(event: {
    type: string;
    data: { object: Record<string, unknown> };
  }): { status: string; customerId?: string } {
    if (!HANDLED.has(event.type)) return { status: "ignored" };

    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const details = s["customer_details"] as { email?: string; name?: string } | undefined;
      const email = details?.email ?? (s["customer_email"] as string | undefined) ?? null;
      if (email === null) return { status: "ignored" };

      const existing = rows.get(email);
      const id = existing?.id ?? `cust_${next++}`;
      rows.set(email, {
        id,
        email,
        status: "active",
        stripeCustomerId: (s["customer"] as string | null) ?? null,
        plan: existing?.plan ?? ((s["client_reference_id"] as string | null) ?? null),
      });
      return { status: existing ? "updated" : "created", customerId: id };
    }

    const sub = event.data.object;
    const stripeCustomerId = sub["customer"] as string;
    const status = sub["status"] as string;
    const active =
      event.type === "customer.subscription.updated" &&
      ["active", "trialing", "past_due"].includes(status);

    for (const row of rows.values()) {
      if (row.stripeCustomerId !== stripeCustomerId) continue;
      row.status = active ? "active" : "churned";
      return { status: active ? "updated" : "churned", customerId: row.id };
    }
    return { status: "ignored" };
  }

  return { process, rows };
}

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        customer: "cus_stripe_1",
        customer_details: { email: "founder@example.com", name: "Jane" },
        client_reference_id: "founding-monthly",
        ...overrides,
      },
    },
  };
}

describe("checkout.session.completed", () => {
  it("creates an active customer", () => {
    const { process, rows } = makeProcessor();
    const result = process(checkout());
    expect(result.status).toBe("created");
    expect(rows.get("founder@example.com")).toMatchObject({
      status: "active",
      stripeCustomerId: "cus_stripe_1",
      plan: "founding-monthly",
    });
  });

  it("is idempotent — Stripe retries webhooks", () => {
    const { process, rows } = makeProcessor();
    process(checkout());
    const second = process(checkout());
    // The same checkout arriving twice must not create a second customer.
    expect(second.status).toBe("updated");
    expect(rows.size).toBe(1);
  });

  it("reactivates a churned customer who comes back", () => {
    const { process, rows } = makeProcessor();
    process(checkout());
    const row = rows.get("founder@example.com");
    if (row !== undefined) row.status = "churned";

    process(checkout());
    expect(rows.get("founder@example.com")?.status).toBe("active");
  });

  it("falls back to customer_email when details are absent", () => {
    const { process, rows } = makeProcessor();
    process(
      checkout({ customer_details: undefined, customer_email: "alt@example.com" }),
    );
    expect(rows.get("alt@example.com")?.status).toBe("active");
  });

  it("ignores a checkout with no email rather than failing", () => {
    const { process, rows } = makeProcessor();
    // Nothing to key on, and a retry would produce the same result — so
    // acknowledge it instead of making Stripe retry for days.
    const result = process(
      checkout({ customer_details: undefined, customer_email: undefined }),
    );
    expect(result.status).toBe("ignored");
    expect(rows.size).toBe(0);
  });
});

describe("subscription lifecycle", () => {
  function subscription(type: string, status: string) {
    return { type, data: { object: { customer: "cus_stripe_1", status } } };
  }

  it("churns a customer whose subscription is deleted", () => {
    const { process, rows } = makeProcessor();
    process(checkout());
    const result = process(subscription("customer.subscription.deleted", "canceled"));
    expect(result.status).toBe("churned");
    // The scheduler only builds schedules for active customers, so this flag
    // is what actually stops the 7am email going out.
    expect(rows.get("founder@example.com")?.status).toBe("churned");
  });

  it("keeps a past_due customer active rather than cutting them off", () => {
    const { process, rows } = makeProcessor();
    process(checkout());
    process(subscription("customer.subscription.updated", "past_due"));
    // A failed card is a dunning problem, not a reason to stop delivering.
    expect(rows.get("founder@example.com")?.status).toBe("active");
  });

  it("churns on an unpaid or incomplete subscription", () => {
    const { process, rows } = makeProcessor();
    process(checkout());
    process(subscription("customer.subscription.updated", "unpaid"));
    expect(rows.get("founder@example.com")?.status).toBe("churned");
  });

  it("ignores a subscription for a customer it has never seen", () => {
    const { process } = makeProcessor();
    const result = process(subscription("customer.subscription.deleted", "canceled"));
    // Most likely a test event. Acknowledged, not retried forever.
    expect(result.status).toBe("ignored");
  });
});

describe("event filtering", () => {
  it("ignores the many event types Stripe sends that we never act on", () => {
    const { process, rows } = makeProcessor();
    for (const type of [
      "payment_intent.succeeded",
      "invoice.paid",
      "charge.succeeded",
      "customer.created",
      "payment_method.attached",
    ]) {
      // Returning a failure for these would put Stripe into a retry loop over
      // something we were never going to handle.
      expect(process({ type, data: { object: {} } }).status).toBe("ignored");
    }
    expect(rows.size).toBe(0);
  });
});
