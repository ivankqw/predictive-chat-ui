import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Predictive workspace",
  description: "A local-first workspace that suggests the right tool for a draft.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster 
          position="top-center" 
          toastOptions={{
            duration: 3000,
            className: "bg-black/70 text-white border border-white/10 backdrop-blur-md",
            style: {
              fontFamily: "var(--font-geist-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
