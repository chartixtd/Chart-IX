"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminHeader } from "./AdminHeader";
import { AdminSidebar } from "./AdminSidebar";

/**
 * 后台的布局外壳。
 *
 * 存在的理由：admin/layout.tsx 是 server component，拿不到 useState，而手机上
 * 侧边栏要收成抽屉、header 要有汉堡按钮，两者必须共享同一个开关状态。
 *
 * 选组件内 state 而不是 zustand：这是纯局部 UI 状态，只有这三个组件关心，
 * 也不需要跨路由持久化——为一个布尔量建全局 store 是过度设计。
 *
 * 注意：JSX 顺序有意义——AdminSidebar（含遮罩）必须渲染在 AdminHeader 之后。
 * header 是 sticky z-40，遮罩也是 z-40，同级下靠 DOM 顺序决胜；顺序反了
 * 抽屉滑出来会被 header 压住。重排这段 JSX 前先想清楚这一点。
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  // 抽屉打开时 Esc 关闭。不做焦点陷阱：这是单人使用的内部后台，
  // Esc + 点遮罩 + 点导航项三条关闭路径已经够用。
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="min-h-dvh bg-bg-primary">
      <AdminHeader onMenuClick={toggleSidebar} />
      <div className="flex">
        <AdminSidebar open={sidebarOpen} onClose={closeSidebar} />
        <main className="ml-0 flex-1 p-4 lg:ml-56 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
