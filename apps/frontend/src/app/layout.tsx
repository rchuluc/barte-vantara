import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vantara",
  description: "Vantara foundations",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
