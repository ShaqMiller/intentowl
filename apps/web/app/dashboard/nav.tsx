"use client";

/**
 * Sidebar navigation. Client-side only because it needs the current path to
 * mark the active section — everything else in the shell stays on the server.
 */
import { usePathname } from "next/navigation";

import {
  IconInbox,
  IconSearch,
  IconSliders,
  IconTarget,
} from "./icons.tsx";

const LINKS = [
  { href: "/dashboard", label: "Leads", exact: true, icon: IconInbox },
  { href: "/dashboard/searches", label: "Searches", icon: IconSearch },
  { href: "/dashboard/profile", label: "What you sell", icon: IconTarget },
  { href: "/dashboard/settings", label: "Settings", icon: IconSliders },
];

export function SideNav() {
  const path = usePathname();

  return (
    <nav className="side-nav">
      {LINKS.map((link) => {
        const active = link.exact
          ? path === link.href
          : path.startsWith(link.href);
        const Icon = link.icon;
        return (
          <a
            key={link.href}
            href={link.href}
            className={active ? "side-link active" : "side-link"}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
