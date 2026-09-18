import type { Metadata } from "next";

import { ReviewQueue } from "@/components/admin/ReviewQueue";

export const metadata: Metadata = { title: "Review" };

export default function AdminReviewPage() {
  return <ReviewQueue />;
}
