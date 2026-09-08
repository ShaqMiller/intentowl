/**
 * Feedback token tests.
 *
 * This token is the only thing standing between a public URL and another
 * customer's training data, so the forgery cases matter more than the happy
 * path.
 */
import { describe, expect, it } from "vitest";

import {
  isFeedbackVerdict,
  signFeedbackToken,
  verifyFeedbackToken,
} from "./feedback.ts";

const SECRET = "test-secret-not-a-real-one";
const CUSTOMER = "23c3dd85-b43f-441f-90b0-544130952f15";
const ITEM = "89712afc-173b-47a9-ae9a-6585e6a56b24";

describe("feedback tokens", () => {
  it("round-trips a customer and item", () => {
    const token = signFeedbackToken(SECRET, CUSTOMER, ITEM);
    expect(verifyFeedbackToken(SECRET, token)).toEqual({
      customerId: CUSTOMER,
      itemId: ITEM,
    });
  });

  it("produces a URL-safe token with no separators", () => {
    const token = signFeedbackToken(SECRET, CUSTOMER, ITEM);
    expect(token).toMatch(/^[0-9a-f]{80}$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("is deterministic, so the same digest can be re-rendered", () => {
    expect(signFeedbackToken(SECRET, CUSTOMER, ITEM)).toBe(
      signFeedbackToken(SECRET, CUSTOMER, ITEM),
    );
  });

  it("rejects a token signed with a different secret", () => {
    const token = signFeedbackToken("other-secret", CUSTOMER, ITEM);
    expect(verifyFeedbackToken(SECRET, token)).toBeNull();
  });

  it("rejects a payload edited to point at another customer", () => {
    const token = signFeedbackToken(SECRET, CUSTOMER, ITEM);
    // Swap the first payload character — the signature no longer matches.
    const tampered = (token[0] === "a" ? "b" : "a") + token.slice(1);
    expect(verifyFeedbackToken(SECRET, tampered)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signFeedbackToken(SECRET, CUSTOMER, ITEM);
    const tampered = token.slice(0, 79) + (token[79] === "a" ? "b" : "a");
    expect(verifyFeedbackToken(SECRET, tampered)).toBeNull();
  });

  it("rejects wrong lengths and non-hex without throwing", () => {
    for (const bad of [
      "",
      "abc",
      "z".repeat(80),
      "a".repeat(79),
      "a".repeat(81),
      "../../etc/passwd",
    ]) {
      expect(verifyFeedbackToken(SECRET, bad)).toBeNull();
    }
  });

  it("does not confuse the two ids", () => {
    // Signing (a, b) must not verify as (b, a) — otherwise a customer could
    // vote on an item by presenting their own id in the item position.
    const forward = signFeedbackToken(SECRET, CUSTOMER, ITEM);
    const backward = signFeedbackToken(SECRET, ITEM, CUSTOMER);
    expect(forward).not.toBe(backward);
    expect(verifyFeedbackToken(SECRET, backward)).toEqual({
      customerId: ITEM,
      itemId: CUSTOMER,
    });
  });
});

describe("isFeedbackVerdict", () => {
  it("accepts only up and down", () => {
    expect(isFeedbackVerdict("up")).toBe(true);
    expect(isFeedbackVerdict("down")).toBe(true);
    for (const bad of ["UP", "yes", "", null, undefined, 1, {}]) {
      expect(isFeedbackVerdict(bad)).toBe(false);
    }
  });
});
