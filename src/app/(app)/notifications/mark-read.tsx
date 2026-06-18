"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markAllRead } from "./actions";

/** On mount, clears unread notifications so the bell badge updates. */
export function MarkRead({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (!hasUnread || done.current) return;
    done.current = true;
    markAllRead().then(() => router.refresh());
  }, [hasUnread, router]);

  return null;
}
