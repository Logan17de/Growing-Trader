import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./styles.css";

const bodyFont = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const displayFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: "Growing Trader | Operations Terminal", template: "%s | Growing Trader" },
  description: "Secure NIFTY market, strategy, risk, and paper-execution operations terminal",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body></html>;
}
