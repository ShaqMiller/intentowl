"use client";

/**
 * Tab strip for the dashboard panes.
 *
 * Client-side rather than URL-driven on purpose. The search editor is one form
 * spanning three tabs with a single save, so switching tabs must not remount
 * the panes — a URL tab would throw away whatever the customer had typed in
 * the tab they just left. Every pane stays mounted and is hidden with the
 * `hidden` attribute, which keeps its inputs in the DOM and in the form.
 *
 * That also means the panes are server-rendered: they arrive as props from a
 * server component and this only decides which one is visible.
 */
import { useId, useState, type ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

export function Tabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const base = useId();

  return (
    <div className="tabwrap">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => {
          const on = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${base}-${tab.id}-tab`}
              aria-selected={on}
              aria-controls={`${base}-${tab.id}`}
              className={on ? "tab on" : "tab"}
              onClick={() => setActive(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          // `hidden` rather than unmounting: the search editor is one form
          // across every pane, and unmounting would drop unsaved input.
          hidden={tab.id !== active}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
