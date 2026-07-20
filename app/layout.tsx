import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Кладовая — управление арендой",
  description: "Внутренняя система учета аренды кладовок, гаражей и боксов"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
