import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Priority ERP — עוזר חכם",
  description: "ממשק צ'אט מבוסס בינה מלאכותית עבור Priority ERP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
