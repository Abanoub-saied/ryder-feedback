import type { Metadata } from "next";

import { RoadmapView } from "@/components/RoadmapView";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "What Ryder is planning, building and has shipped — driven entirely by votes on the public feedback board.",
};

export default function RoadmapPage() {
  return <RoadmapView />;
}
