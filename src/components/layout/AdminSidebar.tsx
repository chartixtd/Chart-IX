"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/Icon";

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("admin");
  const locale = useLocale();

  // 图标从 emoji 换成矢量：emoji 的字形由系统 emoji 字体决定，
  // Windows/Android/Linux 各渲染一套，且无法跟随 currentColor 做选中态变色。
  const ADMIN_NAV: { href: string; label: string; icon: IconName }[] = [
    { href: "/admin", label: t("dashboard"), icon: "dashboard" },
    { href: "/admin/users", label: t("users"), icon: "users" },
    { href: "/admin/videos", label: t("videos"), icon: "video" },
    { href: "/admin/quizzes", label: t("quizzes"), icon: "quiz" },
    { href: "/admin/articles", label: t("articles"), icon: "article" },
    { href: "/admin/briefing", label: t("briefing"), icon: "briefing" },
    { href: "/admin/pricing", label: t("pricing"), icon: "pricing" },
    { href: "/admin/telegram-push", label: t("telegram_push"), icon: "telegram" },
    { href: "/admin/settings", label: t("settings"), icon: "settings" },
    { href: "/admin/logs", label: t("logs"), icon: "logs" },
  ];

  return (
    <>
      {/* 手机上的遮罩：点它关抽屉。z-40 与 sticky 的 header 同级，靠 DOM 顺序
          盖住 header——AdminShell 里本组件必须渲染在 AdminHeader 之后 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "glass fixed left-0 top-14 z-50 flex h-[calc(100vh-3.5rem)] w-56 flex-col overflow-y-auto border-r border-border-default transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <nav className="flex-1 space-y-0.5 p-3">
          {ADMIN_NAV.map((item) => {
            const isActive =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // 后台是数据面：圆角收在 4px，密度优先
                  "relative flex items-center gap-3 rounded-sm py-2 pl-4 pr-3 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/60",
                  isActive
                    ? "bg-gold/10 font-medium text-gold"
                    : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                )}
              >
                {/* 左缘一道金箔竖条标出当前位置——侧栏项多，只靠底色区分不够快 */}
                {isActive && (
                  <span
                    aria-hidden
                    className="foil absolute inset-y-1 left-0 w-[2px] rounded-none shadow-none"
                  />
                )}
                <Icon name={item.icon} className="h-[18px] w-[18px]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border-default p-3">
          <Link
            href={`/${locale}/dashboard`}
            onClick={onClose}
            className="flex items-center gap-3 rounded-sm px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            <Icon name="arrowRight" className="h-[18px] w-[18px] rotate-180" />
            <span>{t("back_to_site")}</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
