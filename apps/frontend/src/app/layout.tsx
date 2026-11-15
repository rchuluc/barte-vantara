import type { Metadata } from "next";
import "./globals.css";

import { DatadogRum } from "@/components/datadog-rum";

export const metadata: Metadata = {
  title: "Vantara",
  description: "Vantara foundations",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DatadogRum />
        {children}
      </body>
    </html>
  );
}
