"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import { toComment, toEvent, toPost } from "@/lib/serialize";
import type { Comment, Post, PostEvent } from "@/lib/types";

/** Live view of one ticket: the post, its comments, and its status history. */
export function usePost(postId: string) {
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [events, setEvents] = useState<PostEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const db = getDb();

    const unsubPost = onSnapshot(
      doc(db, "posts", postId),
      (snap) => {
        if (!snap.exists()) {
          setMissing(true);
          setPost(null);
        } else {
          setPost(toPost(snap));
          setMissing(false);
        }
        setLoading(false);
      },
      () => {
        setMissing(true);
        setLoading(false);
      },
    );

    const unsubComments = onSnapshot(
      query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc")),
      (snap) => setComments(snap.docs.map((d) => toComment(d, postId))),
      () => setComments([]),
    );

    const unsubEvents = onSnapshot(
      query(collection(db, "posts", postId, "events"), orderBy("createdAt", "asc")),
      (snap) => setEvents(snap.docs.map(toEvent)),
      () => setEvents([]),
    );

    return () => {
      unsubPost();
      unsubComments();
      unsubEvents();
    };
  }, [postId]);

  return { post, comments, events, loading, missing };
}
