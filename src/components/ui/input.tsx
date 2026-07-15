"use client";

import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`input-base ${className}`}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
