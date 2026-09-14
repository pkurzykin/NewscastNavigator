import Button from "@mui/material/Button";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  children: ReactNode;
  primaryAction?: boolean;
}

const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton({ children, primaryAction = false, className = "", ...props }, ref) {
    const classes = className.split(/\s+/);
    const variant = primaryAction || classes.includes("primary") ? "contained"
      : classes.includes("text-button") ? "text" : "outlined";
    return (
      <Button ref={ref} type="button" variant={variant}
        color={classes.includes("danger") ? "error" : "primary"}
        className={classes.filter((name) => !["primary", "secondary", "danger", "text-button"].includes(name)).join(" ")}
        data-primary-action={variant === "contained" ? "true" : undefined} {...props}>
        {children}
      </Button>
    );
  },
);
export default ActionButton;
