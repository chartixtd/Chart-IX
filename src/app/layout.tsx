import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chart-IX",
  description: "Cryptocurrency trading education platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
