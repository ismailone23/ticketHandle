import type { Metadata } from "next";
import localFont from "next/font/local";
import { SessionProvider } from "@/components/session-provider";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "TicketHandle — train tickets",
  description: "Search trains, pick your seats, pay, and board with a QR ticket.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-dvh">
        <SessionProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-24 sm:px-6">{children}</main>
          <Toaster position="top-right" richColors offset={{ top: 72, right: 24 }} mobileOffset={{ top: 64 }} />
        </SessionProvider>
      </body>
    </html>
  );
}
