/**
 * Shared page furniture: the sticky nav and the footer.
 *
 * Both take the checkout destination as a prop rather than reading env
 * themselves, so there is exactly one place in the app that decides what
 * "Sign up" means depending on whether Stripe is wired yet.
 *
 * Below 900px the centre links fold into a menu button. It is a native
 * <details>, so it works without JavaScript and is keyboard-operable as is.
 */
import type { ReactNode } from "react";

import { OwlLogo } from "../owl.tsx";

/** The logo mark. Kept under this name because the dashboard imports it too. */
export function OwlMark({ size = 36 }: { size?: number }) {
  return <OwlLogo size={size} />;
}

const NAV_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteNav({ signupHref }: { signupHref: string }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="/">
          <OwlMark />
          IntentOwl
        </a>
        <div className="nav-links">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <div className="nav-right">
          <a className="nav-login" href="/login">
            Log in
          </a>
          <a className="btn btn-primary btn-sm" href={signupHref}>
            Start free trial
          </a>
          <details className="nav-menu">
            <summary className="btn btn-sm" aria-label="Menu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <div className="nav-menu-panel">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
              <a href="/login">Log in</a>
            </div>
          </details>
        </div>
      </div>
    </nav>
  );
}

export function SiteFooter({ signupHref }: { signupHref: string }) {
  return (
    <footer className="foot">
      <div className="page">
        <div className="foot-inner">
          <div className="foot-brand">
            {/* Wordmark only: the closing section above already has an Otto,
                and it is one owl per screen. */}
            <a className="foot-wordmark" href="/">
              IntentOwl
            </a>
            <p className="foot-blurb">
              One email each morning with the posts where people are already
              describing the problem you solve.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li>
                <a href="/#how">How it works</a>
              </li>
              <li>
                <a href="/#digest">Sample digest</a>
              </li>
              <li>
                <a href="/#sources">Sources</a>
              </li>
              <li>
                <a href="/#pricing">Pricing</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Account</h4>
            <ul>
              <li>
                <a href="/login">Log in</a>
              </li>
              <li>
                <a href={signupHref}>Sign up</a>
              </li>
              <li>
                <a href="/#faq">FAQ</a>
              </li>
              <li>
                <a href="/privacy">Privacy</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Support</h4>
            <ul>
              {/* Deliberately not a link: replying to a digest is genuinely how
                  support works today, and a mailto to an address nobody reads
                  would be worse than saying so. */}
              <li>Reply to any digest</li>
              <li>Set up by hand, within a day</li>
              <li>Cancel any time</li>
            </ul>
          </div>
        </div>
        <div className="foot-base">
          <span>© {new Date().getFullYear()} IntentOwl</span>
          <span>Reads publicly posted threads. Never posts on your behalf.</span>
        </div>
      </div>
    </footer>
  );
}

export function Shell({
  signupHref,
  children,
}: {
  signupHref: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteNav signupHref={signupHref} />
      {children}
      <SiteFooter signupHref={signupHref} />
    </>
  );
}
