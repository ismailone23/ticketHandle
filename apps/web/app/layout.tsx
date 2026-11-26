import type { Metadata } from "next";
import localFont from "next/font/local";
import { SessionProvider } from "@/components/session-provider";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-sans" });
const mono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "TicketHandle — train tickets",
  description: "Search trains, pick your seats, pay, and board with a QR ticket.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <SessionProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-24">{children}</main>
          <Toaster position="bottom-center" />
        </SessionProvider>
      </body>
    </html>
  );
}
