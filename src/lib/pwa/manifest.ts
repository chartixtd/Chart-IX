export interface ManifestCopy {
  name: string;
  shortName: string;
  description: string;
  tradeShortcut: string;
  screenerShortcut: string;
}

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  display_override: string[];
  background_color: string;
  theme_color: string;
  lang: string;
  dir: "ltr";
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string }[];
}

export function buildManifest(locale: string, copy: ManifestCopy): WebManifest {
  return {
    // 三种语言必须共用同一个 id。id 不同会被浏览器当成三个独立应用，
    // 用户切换语言后会在桌面上装出第二个图标。
    id: "/",
    name: copy.name,
    short_name: copy.shortName,
    description: copy.description,
    // 会安装的基本都是已登录用户，直达仪表盘省一次重定向；
    // 未登录会被 middleware 送去登录页，行为同样正确。
    start_url: `/${locale}/dashboard?source=pwa`,
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#0B0A08",
    theme_color: "#0B0A08",
    lang: locale,
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: copy.tradeShortcut, url: `/${locale}/trade` },
      { name: copy.screenerShortcut, url: `/${locale}/screener` },
    ],
  };
}
