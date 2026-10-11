import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  block?: boolean;
};

export function Button({
  variant = "primary",
  block = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    "ui-button",
    variant === "primary" ? "ui-button-primary" : "ui-button-secondary",
    block ? "ui-button-block" : "",
    className ?? "",
  ]
    .filter((name) => name.length > 0)
    .join(" ");

  return <button type={type} className={classes} {...props} />;
}
