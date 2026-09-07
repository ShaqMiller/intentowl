import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "IntentOwl",
  description:
    "A daily digest of buying-intent posts from the communities your customers live in.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          lineHeight: 1.55,
        }}
      >
        {children}
      </body>
    </html>
  );
}
