import * as React from "react";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`card-base ${className}`}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          ...props.style,
        }}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <div ref={ref} className={`card-content ${className}`} {...props} />
    );
  }
);
CardContent.displayName = "CardContent";

export { Card, CardContent };
