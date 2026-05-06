import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "글로벌 SCM Dashboard",
  description: "Personal Vercel prototype for the global SCM dashboard migration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-950">
        {children}
      </body>
    </html>
  );
}
