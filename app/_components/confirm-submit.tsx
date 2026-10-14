"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function ConfirmSubmit({
  children,
  confirmation,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  confirmation: string;
}) {
  return (
    <button
      {...props}
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
