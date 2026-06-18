"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";
type ToastItem = { id: number; title: string; description?: string; variant: ToastVariant };

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Fire a toast from anywhere (client-side). */
export function toast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const item: ToastItem = { id: ++counter, variant: "default", ...input };
  listeners.forEach((l) => l(item));
}

const icons = {
  default: Info,
  success: CheckCircle2,
  error: AlertCircle,
} as const;

const accent = {
  default: "text-[var(--accent)]",
  success: "text-[var(--success)]",
  error: "text-[var(--danger)]",
} as const;

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4500);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.variant];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
          >
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", accent[t.variant])} />
            <div className="flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-[var(--text-muted)] hover:text-[var(--text)]"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
