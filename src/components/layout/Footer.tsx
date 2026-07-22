import { useTranslations } from "next-intl";
import Link from "next/link";

export function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t border-border-default bg-bg-secondary/50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="max-w-md text-sm text-text-muted">{t("description")}</p>
          <p className="text-xs text-text-muted">{t("copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
