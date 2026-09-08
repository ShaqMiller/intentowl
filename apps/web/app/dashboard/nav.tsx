"use client";

/**
 * Sidebar navigation. Client-side only because it needs the current path to
 * mark the active section — everything else in the shell stays on the server.
 */
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Leads", exact: true },
  { href: "/dashboard/searches", label: "Searches" },
  { href: "/dashboard/profile", label: "What you sell" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function SideNav() {
  const path = usePathname();

  return (
    <nav className="side-nav">
      {LINKS.map((link) => {
        const active = link.exact
          ? path === link.href
          : path.startsWith(link.href);
        return (
          <a
            key={link.href}
            href={link.href}
            className={active ? "side-link active" : "side-link"}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
