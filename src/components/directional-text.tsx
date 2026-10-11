import type { ReactNode } from "react";

type DirectionalTextProps = {
  children: ReactNode;
  dir?: "ltr" | "rtl" | "auto";
  lang?: string;
};

export function DirectionalText({
  children,
  dir = "auto",
  lang,
}: DirectionalTextProps) {
  return (
    <p className="ui-transcript" dir={dir} lang={lang}>
      {children}
    </p>
  );
}
