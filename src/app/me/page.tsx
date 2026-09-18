import type { Metadata } from "next";

import { MeView } from "@/components/MeView";

export const metadata: Metadata = {
  title: "Your activity",
  // Nothing here is public and all of it is per-visitor, so there is
  // nothing for a crawler to usefully index.
  robots: { index: false, follow: false },
};

export default function MePage() {
  return <MeView />;
}
