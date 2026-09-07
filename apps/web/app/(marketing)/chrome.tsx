/**
 * Shared page furniture: the sticky nav and the footer.
 *
 * Both take the checkout destination as a prop rather than reading env
 * themselves, so there is exactly one place in the app that decides what
 * "Sign up" means depending on whether Stripe is wired yet.
 */
import type { ReactNode } from "react";

export function OwlMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 22c-4.97 0-9-3.8-9-8.5V10a9 9 0 0 1 18 0v3.5c0 4.7-4.03 8.5-9 8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="8.6" cy="10.6" r="2.7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="15.4" cy="10.6" r="2.7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8.6" cy="10.6" r="1.05" fill="#F0C481" />
      <circle cx="15.4" cy="10.6" r="1.05" fill="#F0C481" />
      <path d="M12 13.8 10.9 15.6h2.2L12 13.8Z" fill="currentColor" />
    </svg>
  );
}

export function SiteNav({ signupHref }: { signupHref: string }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="/">
          <OwlMark />
          IntentOwl
        </a>
        <div className="nav-links">
          <a href="/#how">How it works</a>
          <a href="/#sources">Sources</a>
          <a href="/#pricing">Pricing</a>
          <a href="/#faq">FAQ</a>
        </div>
        <div className="nav-right">
          <a className="nav-login" href="/login">
            Log in
          </a>
          <a className="btn btn-primary btn-sm" href={signupHref}>
            Sign up
          </a>
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
          <div>
            <a className="brand" href="/">
              <OwlMark size={18} />
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
