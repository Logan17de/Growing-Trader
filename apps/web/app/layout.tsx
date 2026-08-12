import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "Growing Trader | Market Control", description: "Secure NIFTY market engine control plane" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
