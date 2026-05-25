import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastsProvider } from "@/components/Toasts";
import PWARegister from "@/components/PWARegister";
import PanneauRaccourcis from "@/components/PanneauRaccourcis";
import BarreChargementRoute from "@/components/BarreChargementRoute";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Revêtement Viking — Revêtement extérieur",
  description: "Revêtement Viking Inc. · RBQ 5811-4299-01 · Soumissions automatisées de revêtement extérieur (soffite, fascia, solin, parement)",
  applicationName: "Revêtement Viking",
  authors: [{ name: "Revêtement Viking Inc." }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Viking",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  metadataBase: new URL("https://app.revetementviking.com"),
  openGraph: {
    type: "website",
    locale: "fr_CA",
    siteName: "Revêtement Viking",
    title: "Revêtement Viking — Soumissions et gestion de chantiers",
    description: "App de gestion pour Revêtement Viking Inc. · RBQ 5811-4299-01 · soumissions automatisées, suivi projets, paie, CRM.",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Revêtement Viking" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Revêtement Viking",
    description: "Revêtement extérieur — soffite, fascia, parement",
    images: ["/icon-512.png"],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const themeColor = "#0f172a";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr-CA"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a href="#contenu-principal" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-emerald-600 focus:text-white focus:px-3 focus:py-2 focus:rounded focus:font-semibold">
          Aller au contenu principal
        </a>
        <ToastsProvider>
          <BarreChargementRoute />
          <div id="contenu-principal">{children}</div>
          <PanneauRaccourcis />
        </ToastsProvider>
        <PWARegister />
      </body>
    </html>
  );
}
