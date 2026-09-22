import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastsProvider } from "@/components/Toasts";
import PWARegister from "@/components/PWARegister";
import PanneauRaccourcis from "@/components/PanneauRaccourcis";
import BarreChargementRoute from "@/components/BarreChargementRoute";
import IndicateurHorsLigne from "@/components/IndicateurHorsLigne";
import PaletteCommande from "@/components/PaletteCommande";
import MicroFlottant from "@/components/MicroFlottant";
import Garde401 from "@/components/Garde401";
import GardeMaintenance from "@/components/GardeMaintenance";
import SplashViking from "@/components/SplashViking";

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
    // /icon est l'icône PNG 512×512 générée par Next (app/icon.tsx). /icon-512.png n'a
    // jamais existé : mesuré 404 en prod le 2026-09-17 — un lien partagé montrait un
    // aperçu sans image.
    images: [{ url: "/icon", width: 512, height: 512, alt: "Revêtement Viking" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Revêtement Viking",
    description: "Revêtement extérieur — soffite, fascia, parement",
    images: ["/icon"],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const themeColor = "#0f172a";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pas de maximumScale=1 : l'utilisateur doit pouvoir zoomer (a11y — WCAG 1.4.4 Resize text).
  // `cover` : la PWA installée (barre d'état translucide) remplit l'écran jusque sous
  // l'encoche ; sans lui, `env(safe-area-inset-*)` vaut 0 et les rembourrages posés dans
  // Navigation (haut) et la barre du bas ne servaient à rien.
  viewportFit: "cover",
};

// Thème sombre appliqué AVANT l'hydratation (pas de flash clair, pas de lecture de
// localStorage dans un rendu) : un seul mécanisme, `html.vk-dark` + localStorage `vk-theme`
// (globals.css, components/BoutonTheme.tsx).
const SCRIPT_THEME = `(function(){try{if(localStorage.getItem("vk-theme")==="dark")document.documentElement.classList.add("vk-dark")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr-CA"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // La classe `vk-dark` est ajoutée par le script ci-dessous avant l'hydratation :
      // React verrait un className différent du rendu serveur et le signalerait.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
        {/* Préconnexions DNS pour APIs externes — gain ~100-300ms sur première requête */}
        <link rel="preconnect" href="https://api.open-meteo.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://geocoding-api.open-meteo.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        {/* Prefetch des routes likely (réduit le délai sur clic vers ces pages) */}
        <link rel="prefetch" href="/projets" />
        <link rel="prefetch" href="/clients" />
        <link rel="prefetch" href="/soumissions/nouveau" />
        {/* Hints couleur thème pour la zone safe area iOS/Android */}
        <meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)" />
      </head>
      <body className="min-h-full flex flex-col">
        <a href="#contenu-principal" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-emerald-600 focus:text-white focus:px-3 focus:py-2 focus:rounded focus:font-semibold">
          Aller au contenu principal
        </a>
        <Garde401 />
        <GardeMaintenance />
        <SplashViking />
        <ToastsProvider>
          <IndicateurHorsLigne />
          <BarreChargementRoute />
          <div id="contenu-principal">{children}</div>
          <PanneauRaccourcis />
          <PaletteCommande />
          <MicroFlottant />
        </ToastsProvider>
        <PWARegister />
      </body>
    </html>
  );
}
