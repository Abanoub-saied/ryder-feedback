import type { Metadata } from "next";

import { IdeasTable } from "@/components/admin/IdeasTable";

export const metadata: Metadata = { title: "Ideas" };

export default function AdminIdeasPage() {
  return <IdeasTable />;
}
