"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import type { Board } from "@/lib/types";

export function useBoards() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(getDb(), "boards"), orderBy("order")),
      (snap) => {
        setBoards(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: String(data.name ?? d.id),
              slug: String(data.slug ?? d.id),
              description: String(data.description ?? ""),
              order: Number(data.order ?? 0),
              postCount: Number(data.postCount ?? 0),
            };
          }),
        );
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { boards, loading, error };
}
