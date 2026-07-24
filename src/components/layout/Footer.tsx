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
    <footer className="border-t border-border-default bg-bg-secondary/50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="max-w-md text-sm text-text-muted">{t("description")}</p>
          {telegramUrl && (
            <a
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-gold/50 hover:text-gold"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9.036 15.803l-.396 5.57c.567 0 .812-.244 1.108-.537l2.66-2.545 5.513 4.03c1.01.556 1.73.264 1.99-.933L23.94 3.94c.36-1.464-.53-2.037-1.51-1.68L1.11 10.44c-1.44.556-1.42 1.35-.245 1.708l5.462 1.704L18.9 6.297c.545-.36 1.04-.16.633.2z" />
              </svg>
              {t("join_telegram")}
            </a>
          )}
          <p className="text-xs text-text-muted">{t("copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
