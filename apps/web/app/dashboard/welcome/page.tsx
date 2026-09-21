/**
 * First-run setup. New customers land here from the leads page until they
 * have a profile and a search; everyone else is sent back to their leads.
 *
 * `?preview=1` shows the wizard to an account that is already set up, with
 * saving disabled, so it can be reviewed locally. Development only.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { env } from "../../../src/env.ts";
import { getProfile, listWatches } from "../../../src/queries.ts";
import { requireCustomer } from "../../../src/session.ts";
import { SetupWizard } from "./wizard.tsx";

export const metadata: Metadata = { title: "Set up" };

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const customer = await requireCustomer();
  const params = await searchParams;
  const [profile, watches] = await Promise.all([getProfile(customer.id), listWatches(customer.id)]);

  const setUp = (profile?.productDesc ?? null) !== null && watches.length > 0;
  const preview = process.env.NODE_ENV !== "production" && params["preview"] === "1";
  if (setUp && !preview) redirect("/dashboard");

  return (
    <main className="wizard-page">
      <SetupWizard
        drafting={env.ANTHROPIC_API_KEY !== undefined}
        preview={setUp && preview}
        intro={
          <>
            <h1>Set up IntentOwl</h1>
            <p>
              Three minutes. Tell us what you sell, check the search we draft from it, and the first
              posts start arriving today. Your first digest lands tomorrow at{" "}
              {String(customer.digestHour).padStart(2, "0")}:00.
            </p>
          </>
        }
      />
    </main>
  );
}
