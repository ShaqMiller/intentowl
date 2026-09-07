/**
 * Landing page placeholder.
 *
 * The real thing — problem framing, sample digest, founding price, two Stripe
 * Payment Links — is M5 (ARCHITECTURE.md section 4.7 and 8). This exists so
 * `pnpm dev` boots both apps at M0.
 */
export default function LandingPage() {
  return (
    <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>IntentOwl</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        A daily digest of buying-intent posts from the communities your
        customers live in.
      </p>
      <p style={{ color: "#888", fontSize: "0.875rem" }}>
        Skeleton — landing page and checkout land in M5.
      </p>
    </main>
  );
}
