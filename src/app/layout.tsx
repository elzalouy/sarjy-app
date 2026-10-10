import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, color: "#111", background: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
