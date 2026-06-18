import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--accent)]/10 text-[var(--accent)]",
        neutral:
          "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]",
        success: "border-transparent bg-[var(--success)]/12 text-[var(--success)]",
        warning: "border-transparent bg-[var(--warning)]/12 text-[var(--warning)]",
        danger: "border-transparent bg-[var(--danger)]/12 text-[var(--danger)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
