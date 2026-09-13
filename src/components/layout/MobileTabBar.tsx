"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MOBILE_TABS,
  GUEST_MOBILE_TABS,
  resolveActiveTab,
  resolveActiveGuestTab,
  type TabKey,
} from "@/lib/nav/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useLiveSignalCount } from "@/hooks/useLiveSignalCount";

/** 选中格那块牌子左右各留的空。牌宽 = 最窄一格 − 这个数的两倍 */
const TILE_INSET_X = 7;

/**
 * 底栏图标。全部共用 24 viewBox / currentColor / 1.5 描边，与 ui/Icon.tsx 同源。
 *
 * 两个刻意的选择：
 *   - dashboard 与 home 是同一枚房子。两条底栏（已登录 / 访客）永不同时出现，
 *     而这两格的文案都是「首页」——画两枚不同的房子只是让同一个意思有两张脸。
 *   - screener 是同心弧的雷达而不是放大镜。这一页在产品里是一台每十五分钟
 *     扫一轮的机器，放大镜说的是「搜索」，那是另一件事。
 */
function TabIcon({ tab, className }: { tab: TabKey; className?: string }) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (tab) {
    case "dashboard":
    case "home":
      return (
        <svg {...common}>
          <path d="M3.5 11 12 4l8.5 7" />
          <path d="M6 9.7V20h12V9.7" />
          <path d="M10 20v-4.6h4V20" />
        </svg>
      );
    case "learn":
      return (
        <svg {...common}>
          <path d="M12 7.2C10.5 5.7 8.3 5 5.4 5A1.4 1.4 0 0 0 4 6.4v10.2A1.4 1.4 0 0 0 5.4 18c2.9 0 5.1.7 6.6 2 1.5-1.3 3.7-2 6.6-2a1.4 1.4 0 0 0 1.4-1.4V6.4A1.4 1.4 0 0 0 18.6 5c-2.9 0-5.1.7-6.6 2.2z" />
          <path d="M12 7.2V20" />
        </svg>
      );
    case "screener":
      return (
        <svg {...common}>
          <path d="M12 3.9a8.1 8.1 0 1 1-5.73 2.37" />
          <path d="M12 8.5a3.5 3.5 0 1 1-2.47 1.03" />
          <path
            d="M11.5 11.5h3a.7.7 0 0 1 .5 1.2l-3 3a.7.7 0 0 1-1.2-.5v-3a.7.7 0 0 1 .7-.7z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case "trade":
      return (
        <svg {...common}>
          <path d="M8.5 3.7v2.7M8.5 15.3v2.7" />
          <rect x="6.4" y="6.4" width="4.2" height="8.9" rx="1" />
          <path d="M15.5 6.2v2.6M15.5 17v2.8" />
          <rect x="13.4" y="8.8" width="4.2" height="8.2" rx="1" />
        </svg>
      );
    case "tools":
      return (
        <svg {...common}>
          <path d="M4 8h4.6M12.8 8H20" />
          <circle cx="10.7" cy="8" r="2.1" />
          <path d="M4 16h9.7M17.9 16H20" />
          <circle cx="15.8" cy="16" r="2.1" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="18.8" cy="12" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/**
 * 手机底栏 —— 一块浮起的基座，选中格上压一面金牌。
 *
 * 上一版底栏正中顶着一枚 56px 的金箔圆盘，三个理由把它拿掉了：它把整页的金
 * 额度花在了固定装饰上（`/upgrade` 那页会同时出现两枚一样的 56px 金圆盘）；
 * 交易终端上它是纯装饰；而凸起圆盘在手机语法里意味着「动作」，点下去该升起
 * 一张 sheet，这里点下去只是换页。
 *
 * 现在的构造是三层，每一层只负责一件事：
 *   1. **基座**：底栏脱开屏幕边缘 10px，成为一块 18px 圆角、1px 描边、顶棱
 *      一线微光的墨色石板。体量由它承担，不由金承担。
 *   2. **金牌**：选中格上压一面金渐变的牌子，顶棱一线亮金。它是**定宽**的，
 *      在格与格之间平移——不用 scaleX 缩，缩会把 14px 的圆角一起压扁。
 *   3. **角标**：「选币」那一格上写着现在有几个活着的信号。它是这条底栏上
 *      唯一一处会自己变的东西，也是唯一值得打断你的东西。
 *
 * 板浮起来之后，两侧 10px 与底下 12px 是透的。内容不会从缝里漏出来靠两层：
 * `pb-tabbar`（= --tabbar-h + 安全区）把内容挡在整条 nav 之上；滚动过程中
 * 内容仍会从缝里穿过去，所以 nav 自己是不透明墨底，再在它上沿盖一段 24px 的
 * `bg-ink-fade`，内容在碰到板之前就化进墨里。
 *
 * 不用 `backdrop-filter`：这条底栏挂在交易页上正压着 K 线画布。
 */
export function MobileTabBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const auth = useAuth();

  const isGuest = !auth.loading && !auth.userId;
  const tabs = isGuest ? GUEST_MOBILE_TABS : MOBILE_TABS;

  // 底栏是 lg:hidden——桌面上它仍然挂载，但一个看不见的角标不该去拉数据
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const signals = useLiveSignalCount(!isGuest && isMobile);

  const active = useMemo(
    () => (isGuest ? resolveActiveGuestTab(pathname, locale) : resolveActiveTab(pathname, locale)),
    [isGuest, pathname, locale]
  );

  const railRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<TabKey, HTMLAnchorElement | null>());
  /** 金牌的中心与宽度，px，相对板的左内缘。null = 当前路径不属于任何一格 */
  const [tile, setTile] = useState<{ x: number; w: number } | null>(null);
  // 首帧不滑：刚挂载时金牌该直接出现在当前格上，而不是从板的最左边滑过来
  const [glide, setGlide] = useState(false);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const cell = active ? cellRefs.current.get(active) : null;
      if (!cell) {
        setTile(null);
        return;
      }
      // 牌宽取最窄的一格：定宽才能只平移不缩放，圆角因此不会被压扁
      let narrowest = Infinity;
      for (const node of cellRefs.current.values()) {
        if (node) narrowest = Math.min(narrowest, node.offsetWidth);
      }
      setTile({
        x: cell.offsetLeft + cell.offsetWidth / 2,
        w: Math.max(0, narrowest - TILE_INSET_X * 2),
      });
    };

    measure();
    // 横竖屏切换、访客/已登录切换导致格数变化时重新量
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [active, tabs]);

  useEffect(() => {
    if (!tile || glide) return;
    const id = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(id);
  }, [tile, glide]);

  return (
    <nav
      data-tabbar={isGuest ? "guest" : "user"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 bg-bg-primary px-2.5 lg:hidden",
        "pb-[calc(12px+env(safe-area-inset-bottom))]"
      )}
      aria-label={t("primary")}
    >
      {/* 滚动中的内容在碰到板之前就化进墨里，板的上边缘因此永远是干净的 */}
      <span aria-hidden className="absolute inset-x-0 bottom-full h-6 bg-ink-fade" />

      <div
        ref={railRef}
        className={cn(
          "relative grid h-16 rounded-[18px] border border-border-default bg-bg-elevated",
          // 顶棱一线微光 + 一层向下扩散的投影，让板读起来是浮着的而不是贴着的
          "shadow-[inset_0_1px_0_rgba(238,220,166,0.10),0_-14px_44px_-18px_rgba(0,0,0,0.95)]"
        )}
        style={{
          // 中心格宽一点。纯粹是拇指落点——层级由金牌与角标给，不由格宽给
          gridTemplateColumns: tabs.map((tab) => (tab.anchor ? "1.15fr" : "1fr")).join(" "),
        }}
      >
        {tile && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-2 left-0 rounded-[13px] bg-tabbar-tile",
              "shadow-[inset_0_1px_0_rgba(238,220,166,0.16)]",
              glide && "transition-transform duration-300 ease-out"
            )}
            style={{
              width: tile.w,
              transform: `translate3d(${tile.x - tile.w / 2}px, 0, 0)`,
            }}
          />
        )}

        {tabs.map((tab) => {
          const isActive = active === tab.key;
          // 角标只挂在「选币」上，且只在真的有活着的信号时出现——不闪一个 0
          const badge = tab.key === "screener" && signals ? signals : null;

          return (
            <Link
              key={tab.key}
              ref={(node) => {
                cellRefs.current.set(tab.key, node);
              }}
              href={tab.href(locale)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative z-10 flex flex-col items-center justify-center gap-1.5",
                "transition-colors duration-200",
                isActive ? "text-gold" : "text-text-muted"
              )}
            >
              <span className="relative">
                <TabIcon
                  tab={tab.key}
                  // 按下即刻见反馈。悬停什么都不做——这一面的规矩是悬停只变描边
                  className="h-[22px] w-[22px] transition-transform duration-100 group-active:scale-90"
                />
                {badge !== null && (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -right-2.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center",
                        "rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-bg-primary"
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                    <span className="sr-only">{t("live_signals", { count: badge })}</span>
                  </>
                )}
              </span>
              <span className="text-[11px] font-medium leading-none tracking-[0.02em]">
                {t(`tab_${tab.key}`)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
