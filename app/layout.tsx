import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./components/providers";
import { publicSpotrConfig } from "./lib/spotr-config/public";

export const metadata: Metadata = {
  title: `${publicSpotrConfig.appName} • ${publicSpotrConfig.seasonLabel}`,
  description: "Mobile-first Solana prediction markets for cultural fault lines.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
