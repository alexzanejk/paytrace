import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      ok: "bg-status-ok-bg text-status-ok",
      warn: "bg-status-warn-bg text-status-warn",
      info: "bg-status-info-bg text-status-info",
      bad: "bg-status-bad-bg text-status-bad",
      idle: "bg-status-idle-bg text-status-idle",
    },
  },
  defaultVariants: { tone: "idle" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
