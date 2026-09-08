"use server";

/**
 * Authentication actions.
 *
 * Two principles run through all of these:
 *
 * 1. **Never confirm whether an email exists.** Sign-in failures, password
 *    resets and account claims all return the same message whether or not the
 *    address is known. Anything else turns the login form into a customer-list
 *    oracle for anyone who wants to know who is paying for this.
 * 2. **Supabase owns credentials, we own entitlement.** Nothing here reads or
 *    stores a password. The link between an auth user and a paid customer is
 *    made in session.ts on first sign-in, not here.
 */
import { redirect } from "next/navigation";

import { env } from "./env.ts";
import { createClient } from "./supabase/server.ts";
import { authConfigured, getAuthUser, requireCustomer } from "./session.ts";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const NOT_CONFIGURED: ActionResult = {
  ok: false,
  message:
    "Sign-in is not connected on this deployment yet. Nothing was changed.",
};

/**
 * Deliberately vague, and deliberately identical for "no such user" and "wrong
 * password". The difference is exactly what an attacker enumerating customers
 * wants to learn.
 */
const BAD_CREDENTIALS =
  "That email and password did not match. If you have never set a password, use the link below.";

function readCredentials(form: FormData): { email: string; password: string } | null {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (trimmed === "" || password === "") return null;
  return { email: trimmed, password };
}

export async function signIn(form: FormData): Promise<ActionResult> {
  if (!authConfigured()) return NOT_CONFIGURED;

  const credentials = readCredentials(form);
  if (credentials === null) {
    return { ok: false, message: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);
  if (error !== null) {
    return { ok: false, message: BAD_CREDENTIALS };
  }

  // redirect() throws to unwind, so it must be the last thing in the action.
  redirect("/dashboard");
}

/**
 * Set a password for a customer who paid but has never signed in.
 *
 * Supabase sends a confirmation email; the session only exists once the link
 * is clicked. That is what makes the account claim in session.ts safe — you
 * have to control the inbox the digest already goes to.
 */
export async function claimAccount(form: FormData): Promise<ActionResult> {
  if (!authConfigured()) return NOT_CONFIGURED;

  const credentials = readCredentials(form);
  if (credentials === null) {
    return { ok: false, message: "Enter your email and a password." };
  }
  if (credentials.password.length < 12) {
    return { ok: false, message: "Use at least 12 characters." };
  }
  if (credentials.password !== form.get("confirm")) {
    return { ok: false, message: "Those two passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...credentials,
    options: { emailRedirectTo: `${env.APP_URL}/auth/callback?next=/dashboard` },
  });

  // Even a genuine failure gets the neutral answer: "that address already has
  // an account" is exactly the fact worth hiding.
  if (error !== null && !/already registered/i.test(error.message)) {
    return { ok: false, message: "Could not send the email. Try again shortly." };
  }

  return {
    ok: true,
    message:
      "If that address is on an IntentOwl account, a confirmation email is on its way. Click the link in it to finish.",
  };
}

export async function requestPasswordReset(form: FormData): Promise<ActionResult> {
  if (!authConfigured()) return NOT_CONFIGURED;

  const email = form.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return { ok: false, message: "Enter your email." };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${env.APP_URL}/auth/callback?next=/dashboard/settings`,
  });

  // The result is not inspected on purpose — the answer is the same either way.
  return {
    ok: true,
    message:
      "If that address is on an IntentOwl account, a reset link is on its way.",
  };
}

export async function signOut(): Promise<void> {
  if (authConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/**
 * Change the signed-in user's password.
 *
 * Requires a current session, so an unattended laptop is the threat model
 * rather than a stolen password. Supabase can be configured to demand
 * reauthentication for this; if that is on, the update fails with a clear
 * message rather than silently doing nothing.
 */
export async function changePassword(form: FormData): Promise<ActionResult> {
  if (!authConfigured()) return NOT_CONFIGURED;

  // Proves there is both a session and a paid customer behind it.
  await requireCustomer();

  const next = form.get("password");
  const confirm = form.get("confirm");
  if (typeof next !== "string" || next.length < 12) {
    return { ok: false, message: "Use at least 12 characters." };
  }
  if (next !== confirm) {
    return { ok: false, message: "Those two passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error !== null) {
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message: "Password changed. Other devices stay signed in until you sign them out.",
  };
}

/**
 * Sign out every *other* session — the thing you want after losing a laptop.
 *
 * Uses `scope: "others"` rather than `"global"`, so the device you are asking
 * from stays signed in. Signing yourself out too would be a worse answer to
 * "my laptop was stolen": you would land on the login page and have to prove
 * yourself again from the one device you still trust.
 *
 * Runs on the user's own client, so it needs no service-role key: revoking
 * your own refresh tokens is something a session is already allowed to do.
 */
export async function signOutEverywhere(): Promise<ActionResult> {
  if (!authConfigured()) return NOT_CONFIGURED;

  const user = await getAuthUser();
  if (user === null) return { ok: false, message: "You are not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error !== null) {
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message: "Every other device has been signed out. This one is still signed in.",
  };
}
