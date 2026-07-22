"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard", icon: "📊" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/videos", label: "Videos", icon: "🎬" },
  { href: "/admin/features", label: "Features", icon: "⚙️" },
  { href: "/admin/pricing", label: "Pricing", icon: "💰" },
  { href: "/admin/risk", label: "Risk Control", icon: "🛡️" },
  { href: "/admin/settings", label: "Settings", icon: "🔧" },
  { href: "/admin/logs", label: "Logs", icon: "📝" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-56 border-r border-border-default glass overflow-y-auto flex flex-col">
      <nav className="p-3 space-y-1 flex-1">
        {ADMIN_NAV.map((item) => {
          const isActive = item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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
          href="/en-US"
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <span className="text-base">←</span>
          <span>Back to Site</span>
        </Link>
      </div>
    </aside>
  );
}
