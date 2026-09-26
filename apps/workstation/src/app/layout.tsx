import type { Metadata } from "next";
import type { PropsWithChildren } from "react";
import { Geist, Geist_Mono, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

/* Canonical families, ENGINEERING_CONTRACT §1.1. Weights 300/400/500/600/700. */
const geist = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

/* Retained for the legacy public marketing routes, which are not part of the
 * frozen twelve-screen product and keep their own type stack. */
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aqualens",
  description:
    "Aqualens turns side-scan sonar surveys into reviewable marine contacts with clear evidence.",
  openGraph: {
    type: "website",
    title: "Aqualens",
    description: "Evidence-backed side-scan sonar analysis and review.",
  },
  twitter: {
    card: "summary",
    title: "Aqualens",
    description: "Evidence-backed side-scan sonar analysis and review.",
  },
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
