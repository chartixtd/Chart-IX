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

/** 光柱的基准宽度。实际宽度靠 scaleX 缩到当前格宽——只动 transform，不动 width */
const LIT_BASE_W = 100;

/**
 * 底栏图标。全部共用 24 viewBox / currentColor / 1.5 描边，与 ui/Icon.tsx 同源。
 *
 * 两个刻意的选择：
 *   - dashboard 与 home 是同一枚房子。两条底栏（已登录 / 访客）永不同时出现，
 *     而这两格的文案都是「首页」——画两枚不同的房子只是让同一个意思有两张脸。
 *   - screener 是表盘而不是放大镜。这一页在产品里就是一台「十五分钟扫描表盘」，
 *     放大镜说的是「搜索」，那是另一件事。表盘 + 扫描臂 + 一个已捕获的光点，
 *     说的正是它每十五分钟替你做的那件事。
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
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 12l5.6-5.6" />
          <circle cx="15.1" cy="15.4" r="1.15" fill="currentColor" stroke="none" />
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
 * 手机底栏 —— 一块浮起的基座。
 *
 * 上一版底栏正中顶着一枚 56px 的金箔圆盘。三个理由把它拿掉了：
 *
 *  1. **它把整页的金额度花在了固定装饰上。** DESIGN.md 的硬规则是「一屏之内实心金
 *     最多一次」，而这枚圆盘出现在每一屏上——于是 /upgrade 那页会同时出现两枚
 *     一模一样的 56px 金圆盘（页面自己那枚 .foil 徽记 + 底栏这枚），任何带
 *     Button primary 的页面也都超额。规则没被违反过一次，是被违反了每一次。
 *  2. **交易终端上它是纯装饰。** 同一条底栏压在 K 线页最下沿，那一面的规矩是
 *     「金退为选中态与关键数据，零装饰」。
 *  3. **凸起圆盘在手机语法里意味着「动作」**（发布 / 新建 / 扫一扫），点下去该
 *     升起一张 sheet。这里点下去只是换页。旧注释自己写着「它是目的地不是动作」——
 *     那句话是在给一个错误的手势打补丁。
 *
 * 换成什么：**体量由那块板承担，不由金承担。** 底栏脱开屏幕边缘 10px，成为一块
 * 有 1px 描边、14px 圆角、顶棱一线微光的墨色石板；选中格被一道金光柱托住，
 * 光柱顶端压一段 30px 金线。整条栏上没有一处实心金，金只剩「一条线 + 一层
 * 15% 的光 + 选中格的字」，额度因此还给了页面本身。
 *
 * 板浮起来之后，两侧 10px 与底下 12px 是透的。内容不会从缝里漏出来靠两层：
 *   - pb-tabbar（= --tabbar-h + 安全区）把内容挡在整条 nav 之上；
 *   - 滚动过程中内容仍会从缝里穿过去，所以 nav 自己是不透明墨底，
 *     再在它上沿盖一段 24px 的 bg-ink-fade，内容在碰到板之前就化进墨里。
 *
 * 「选币」的中心地位改由结构承担而不是材质：它仍在五格正中（拇指的自然落点），
 * 格宽多出 20%，图标大一档，未选中时文字亮一阶。层级由尺寸与明度给，不由金给。
 */
export function MobileTabBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const auth = useAuth();

  const isGuest = !auth.loading && !auth.userId;
  const tabs = isGuest ? GUEST_MOBILE_TABS : MOBILE_TABS;

  const active = useMemo(
    () => (isGuest ? resolveActiveGuestTab(pathname, locale) : resolveActiveTab(pathname, locale)),
    [isGuest, pathname, locale]
  );

  const railRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<TabKey, HTMLAnchorElement | null>());
  /** 选中格的中心与宽度，px，相对板的左内缘。null = 当前路径不属于任何一格 */
  const [lit, setLit] = useState<{ x: number; w: number } | null>(null);
  // 首帧不滑：刚挂载时光柱该直接出现在当前格上，而不是从板的最左边滑过来
  const [glide, setGlide] = useState(false);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const cell = active ? cellRefs.current.get(active) : null;
      if (!cell) {
        setLit(null);
        return;
      }
      setLit({ x: cell.offsetLeft + cell.offsetWidth / 2, w: cell.offsetWidth });
    };

    measure();
    // 横竖屏切换、访客/已登录切换导致格数变化时重新量
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [active, tabs]);

  useEffect(() => {
    if (!lit || glide) return;
    const id = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(id);
  }, [lit, glide]);

  return (
    <nav
      data-tabbar={isGuest ? "guest" : "user"}
      // 不透明墨底 + 上沿一段渐隐：这条底栏挂在交易页上正压着 K 线画布，
      // backdrop-blur 会让低端安卓掉帧，所以玻璃感一律由描边与顶棱微光承担。
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
          "relative grid h-14 overflow-hidden rounded-2xl border border-border-default bg-bg-elevated",
          // 顶棱一线微光 + 一层向下扩散的投影，让板读起来是浮着的而不是贴着的
          "shadow-[inset_0_1px_0_rgba(238,220,166,0.10),0_-14px_44px_-18px_rgba(0,0,0,0.95)]"
        )}
        style={{
          // 中心格宽 20%——拇指的落点，也是 CJK 里最容易折行的那两个字
          gridTemplateColumns: tabs.map((tab) => (tab.anchor ? "1.2fr" : "1fr")).join(" "),
        }}
      >
        {lit && (
          <>
            {/* 光柱：宽度靠 scaleX 缩，不动 width——动 width 会每帧重排 */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 bg-tabbar-lit",
                glide && "transition-transform duration-300 ease-out"
              )}
              style={{
                width: LIT_BASE_W,
                transform: `translate3d(${lit.x - LIT_BASE_W / 2}px, 0, 0) scaleX(${lit.w / LIT_BASE_W})`,
              }}
            />
            {/* 金线单独滑，不跟着光柱缩——被 scaleX 拉过的线会宽窄不一 */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-0 top-0 h-[2px] w-[30px] bg-gold",
                glide && "transition-transform duration-300 ease-out"
              )}
              style={{ transform: `translate3d(${lit.x - 15}px, 0, 0)` }}
            />
          </>
        )}

        {tabs.map((tab) => {
          const isActive = active === tab.key;
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
                isActive
                  ? "text-gold"
                  : tab.anchor
                    // 中心格未选中时亮一阶。层级用明度给，不用色相给——
                    // 暗金标签会与选中的金标签撞成「半选中」
                    ? "text-text-secondary"
                    : "text-text-muted"
              )}
            >
              <TabIcon
                tab={tab.key}
                // 按下即刻见反馈。悬停什么都不做——这一面的规矩是悬停只变描边
                className={cn(
                  "transition-transform duration-100 group-active:scale-90",
                  tab.anchor ? "h-6 w-6" : "h-5 w-5"
                )}
              />
              <span className="text-[10px] font-medium uppercase leading-none tracking-label">
                {t(`tab_${tab.key}`)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
