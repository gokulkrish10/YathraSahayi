import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yathra Sahayi | യാത്ര സഹായി",
  description: "Voice-first bilingual transit assistant for Kochi Metro, Water Metro, and local transport.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Yathra Sahayi",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#061923",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
