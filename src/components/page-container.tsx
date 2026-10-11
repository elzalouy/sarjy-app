import type { ReactNode } from "react";

type PageContainerProps = {
  title: string;
  children: ReactNode;
  width?: "narrow" | "wide";
};

export function PageContainer({
  title,
  children,
  width = "narrow",
}: PageContainerProps) {
  return (
    <main className={width === "wide" ? "ui-page ui-page-wide" : "ui-page"}>
      <div className="ui-card">
        <h1>{title}</h1>
        <div className="ui-stack">{children}</div>
      </div>
    </main>
  );
}
