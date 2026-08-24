/**
 * 交易页外壳高度的唯一出处。
 *
 * 手机：100dvh 减去手机 header(3rem) + 顶部安全区 + 底部 tab bar（含其安全区，
 * 高度走 --tabbar-h，访客底栏没有中央凸起、矮 20px）；桌面：减 4rem 顶栏。
 *
 * page.tsx 的水合骨架、loading.tsx 的路由骨架、真实容器三处必须用同一条
 * 公式——此前骨架写死 100dvh-4rem，iPhone 上比真实容器高约 130px，
 * 每次进入交易页都先撑到底栏底下再缩回来，跳一次布局。
 */
export const TRADE_SHELL_HEIGHT =
  "h-[calc(100dvh-3rem-env(safe-area-inset-top)-var(--tabbar-h,70px)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-4rem)]";
