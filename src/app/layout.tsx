import type { Metadata, Viewport } from "next";
import { Anek_Latin, Geist } from "next/font/google";

import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/components/Toast";
import { CommandPalette } from "@/components/CommandPalette";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Ryder Feedback";

/**
 * The two faces ryder.id ships. Loaded through next/font so they are
 * self-hosted and preloaded: no third-party stylesheet on the critical
 * path, and no flash of a fallback face before the brand font lands.
 */
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

/**
 * ryder.id names its headline face "Anek Latin Expanded". Expanded is the
 * wdth=125 end of Anek Latin's width axis, so keeping `wdth` in the axes
 * list is what makes `font-stretch: 125%` (see the `display` utility in
 * globals.css) resolve to the real face instead of the normal width.
 */
const anekLatin = Anek_Latin({
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
  variable: "--font-anek",
});

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — feature requests and roadmap`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "Tell us what to build next. Vote on ideas from other Ryder users and follow what we are working on.",
  openGraph: {
    title: SITE_NAME,
    description: "Vote on what Ryder builds next, and follow the public roadmap.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

/**
 * Applied before first paint so an explicit theme choice never flashes the
 * wrong palette. Kept tiny and inlined for that reason.
 */
const themeBootstrap = `try{var t=localStorage.getItem("ryder.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${anekLatin.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-pill focus:border focus:border-stroke focus:bg-page focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        <AuthProvider>
          <ToastProvider>
            <CommandPalette>
              <SiteHeader />
              <main id="main">{children}</main>
              <footer className="mx-auto mt-24 max-w-6xl px-4 pb-14 sm:px-6">
                <div className="flex flex-col gap-3 border-t border-stroke pt-6 text-xs text-ink-2 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    Votes are one per person and enforced in the database, not
                    just the UI.
                  </p>
                  <p className="flex items-center gap-2">
                    Press <span className="kbd">⌘K</span> anywhere to search or
                    jump.
                  </p>
                </div>
              </footer>
            </CommandPalette>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
