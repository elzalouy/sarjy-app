import type { ReactNode } from "react";

type AlertProps = {
  tone: "error" | "info";
  children: ReactNode;
};

export function Alert({ tone, children }: AlertProps) {
  return (
    <div
      className={`ui-alert ui-alert-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
