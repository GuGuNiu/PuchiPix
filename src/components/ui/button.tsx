"use client";

import * as React from "react";

type ButtonVariant = "default" | "ghost" | "outline" | "secondary" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "btn btn-primary",
  ghost: "btn btn-ghost",
  outline: "btn btn-outline",
  secondary: "btn btn-secondary",
  destructive: "btn btn-danger",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
  icon: "btn-icon",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "md", ...props }, ref) => {
    const classes = [
      variantClasses[variant],
      sizeClasses[size],
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button ref={ref} className={classes} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button };
export type { ButtonVariant, ButtonSize };
