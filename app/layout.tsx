import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diligence Desk",
  description:
    "Buy verified intelligence per question: a diligence dossier on any company, token listing or payment. Telegraph Hackathon Season II.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
