import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

export function Footer() {
  const t = useTranslations("footer");
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "telegram_group")
      .maybeSingle()
      .then(({ data }) => {
        if (typeof data?.value === "string") setTelegramUrl(data.value);
      });
  }, []);

  return (
    <footer className="border-t border-border-default bg-bg-secondary/40">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Chart-IX" className="h-8 w-auto opacity-90" />
            <span className="font-display text-lg leading-none tracking-tight text-text-primary">
              Chart<span className="text-gold">-IX</span>
            </span>
          </div>

          <div className="hairline-gold w-24" />

          <p className="max-w-md text-sm leading-relaxed text-text-secondary">
            {t("description")}
          </p>

          {telegramUrl && (
            <a
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-gold/25 px-4 py-2 text-xs font-medium text-gold transition-all duration-200 hover:border-gold/60 hover:bg-gold/5"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9.036 15.803l-.396 5.57c.567 0 .812-.244 1.108-.537l2.66-2.545 5.513 4.03c1.01.556 1.73.264 1.99-.933L23.94 3.94c.36-1.464-.53-2.037-1.51-1.68L1.11 10.44c-1.44.556-1.42 1.35-.245 1.708l5.462 1.704L18.9 6.297c.545-.36 1.04-.16.633.2z" />
              </svg>
              {t("join_telegram")}
            </a>
          )}

          <p className="text-xs tracking-wide text-text-muted">{t("copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
