import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  primaryAction?: boolean;
}

const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton(
    {
      children,
      primaryAction = false,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        data-primary-action={primaryAction ? "true" : undefined}
        {...props}
      >
        {children}
      </button>
    );
  },
);

export default ActionButton;
