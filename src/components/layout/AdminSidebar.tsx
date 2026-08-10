"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("admin");
  const locale = useLocale();

  const ADMIN_NAV = [
    { href: "/admin", label: t("dashboard"), icon: "📊" },
    { href: "/admin/users", label: t("users"), icon: "👥" },
    { href: "/admin/videos", label: t("videos"), icon: "🎬" },
    { href: "/admin/quizzes", label: t("quizzes"), icon: "❓" },
    { href: "/admin/articles", label: t("articles"), icon: "📄" },
    { href: "/admin/briefing", label: t("briefing"), icon: "🌅" },
    { href: "/admin/pricing", label: t("pricing"), icon: "💰" },
    { href: "/admin/telegram-push", label: t("telegram_push"), icon: "📨" },
    { href: "/admin/settings", label: t("settings"), icon: "🔧" },
    { href: "/admin/logs", label: t("logs"), icon: "📝" },
  ];

  return (
    <>
      {/* 手机上的遮罩：点它关抽屉。z-40 与 sticky 的 header 同级，靠 DOM 顺序
          盖住 header——AdminShell 里本组件必须渲染在 AdminHeader 之后 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-14 z-50 flex h-[calc(100vh-3.5rem)] w-56 flex-col overflow-y-auto border-r border-border-default glass transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
      <nav className="p-3 space-y-1 flex-1">
        {ADMIN_NAV.map((item) => {
          const isActive = item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-gold/10 text-gold font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              )}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border-default">
        <Link
          href={`/${locale}/dashboard`}
          onClick={onClose}
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <span className="text-base">←</span>
          <span>{t("back_to_site")}</span>
        </Link>
      </div>
      </aside>
    </>
  );
}
