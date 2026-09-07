import type { ReactNode } from "react";

import { Shell } from "./chrome.tsx";

/**
 * Wraps every marketing page in the shared nav and footer.
 *
 * "Sign up" always points at /signup rather than jumping straight to Stripe:
 * the plan choice belongs on a page we own, and it is the only route that
 * still works when the Payment Links are not configured.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <Shell signupHref="/signup">{children}</Shell>;
}
