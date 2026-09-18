import { Suspense } from "react";

import { BoardView } from "@/components/BoardView";

/**
 * BoardView seeds its filters from the query string, so it reads
 * useSearchParams and has to sit behind a Suspense boundary for the
 * shell to stay statically renderable.
 */
export default function FeedbackPage() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <BoardView />
    </Suspense>
  );
}

function BoardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6" aria-busy="true">
      <div className="skeleton h-[168px]" />
      <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[74px]" />
        ))}
      </div>
      <div className="mt-10 space-y-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[108px]" />
        ))}
      </div>
    </div>
  );
}
