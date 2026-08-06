import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Marcellus } from "next/font/google";
import { SITE_URL } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const marcellus = Marcellus({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-marcellus",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Chart-IX",
    template: "%s | Chart-IX",
  },
  description: "Cryptocurrency trading education and live trading platform",
  robots: { index: true, follow: true },
  openGraph: {
    siteName: "Chart-IX",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0B0A08",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout sits above the [locale] segment and has no `params.locale`
  // of its own. Reading the resolved locale here via headers()/cookies() was
  // considered, but a dynamic API in the root layout forces every route in
  // the app into dynamic rendering (undoing the ISR added to the articles/
  // videos/learn pages, and the static admin/marketing pages) — for a single
  // non-visual attribute that's the wrong trade. Correct `lang` is set
  // client-side instead, in ClientLocaleLayout/AdminLocaleProvider, which
  // also handles it staying correct when the language switcher does a
  // client-side navigation between locales without a full page reload.
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable} ${marcellus.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* CJK fonts (Noto Sans/Serif SC) aren't offered as latin-only subsets by next/font,
            so they stay on Google's CDN to keep full Chinese glyph coverage; Inter/JetBrains
            Mono/Marcellus are self-hosted above via next/font.

            Loaded as non-render-blocking: media="print" makes the browser fetch it at low
            priority without gating First Paint on a round trip to Google's CDN, then the
            inline script below flips it to media="all" as soon as it's loaded. This has to
            be a raw <script> rather than React's onLoad prop — the stylesheet can finish
            loading before hydration attaches any React event listener, and by then the
            load event has already fired and would be missed. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          id="noto-sc-stylesheet"
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@500;600;700&display=swap"
          media="print"
          // The inline script below can flip this to media="all" in the live DOM
          // before React hydrates, which would otherwise read as a hydration
          // mismatch — it's expected, not a bug.
          suppressHydrationWarning
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.getElementById('noto-sc-stylesheet').addEventListener('load',function(){this.media='all';});",
          }}
        />
        <noscript>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@500;600;700&display=swap"
          />
        </noscript>
        <meta name="view-transition" content="same-origin" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" />
        {/* iOS 启动图：只覆盖主流 iPhone 尺寸，其余机型冷启动会短暂白屏 */}
        {[
          { w: 1170, h: 2532 },
          { w: 1179, h: 2556 },
          { w: 1284, h: 2778 },
          { w: 1290, h: 2796 },
          { w: 1206, h: 2622 },
          { w: 1320, h: 2868 },
        ].map(({ w, h }) => (
          <link
            key={`${w}x${h}`}
            rel="apple-touch-startup-image"
            href={`/icons/splash/splash-${w}x${h}.png`}
            media={`(device-width: ${w / 3}px) and (device-height: ${h / 3}px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`}
          />
        ))}
      </head>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
