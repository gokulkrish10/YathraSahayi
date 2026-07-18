import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yathra Sahayi | യാത്ര സഹായി",
  description: "Voice-first bilingual transit assistant for Kochi Metro, Water Metro, and local transport.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
