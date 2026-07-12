import type { ButtonHTMLAttributes, ReactNode } from "react";

export default function ActionButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <button type="button" {...props}>{children}</button>;
}
