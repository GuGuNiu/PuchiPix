"use client";

import * as React from "react";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "badge badge-info",
  secondary: "badge badge-default",
  destructive: "badge badge-danger",
  outline: "badge badge-default",
};

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = "", variant = "default", ...props }, ref) => {
    const classes = [variantClasses[variant], className]
      .filter(Boolean)
      .join(" ");
    return <span ref={ref} className={classes} {...props} />;
  }
);
Badge.displayName = "Badge";

export { Badge };
export type { BadgeVariant };
