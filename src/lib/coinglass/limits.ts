/**
 * CoinGlass 配额常量。这个文件必须**零依赖**——不能 import 任何东西，
 * 包括同目录下的 `client.ts`。
 *
 * 原因：`src/lib/screener/types.ts` 要用 `RATE_LIMIT_PER_MIN` 推导
 * `DEEP_SCAN_LIMIT`，而 `screener/types.ts` 被五个客户端组件做值导入
 * （`FactorStack.tsx`/`AlertCard.tsx` 要 `FACTOR_MAX`、`ScannerTable.tsx`
 * 要 `ALERT_TRIGGER_SCORE`、`ScanCountdown.tsx`/`useScreenerData.ts` 要
 * `SCAN_INTERVAL_MS`）。如果这两个常量继续放在 `client.ts` 里，
 * `screener/types.ts` 就必须 import `client.ts`，而 `client.ts` 里的
 * `coinglassGet`、滚动窗口限流器、`process.env.COINGLASS_API_KEY` 读取
 * 这些只该在服务端存在的代码就会跟着这条依赖链一起被打进浏览器 bundle
 * （2026-08-18 评审时发现的真实问题：不是 key 泄漏——Next.js 只内联
 * `NEXT_PUBLIC_` 前缀的环境变量，`process.env.COINGLASS_API_KEY` 在浏览器里
 * 求值就是 `undefined`——但白白多打包一套只服务端用的 HTTP 封装，
 * 而且这条依赖边界很脆：`client.ts` 今天没有 node-only 依赖，一旦以后加了
 * 一个，五个客户端组件会在构建时莫名其妙地失败）。
 *
 * 所以把这两个常量单独放进这个零依赖的叶子模块：`client.ts` 从这里导入着用，
 * `screener/types.ts` 也从这里导入，两边都不再需要经过对方。以后往这个文件
 * 加任何 import 之前，先想一遍这条链——五个客户端组件都会跟着遭殃。
 */

/**
 * CoinGlass 的真实配额，来自响应头 `API-KEY-MAX-LIMIT: 80`。
 * 留 5 次余量给「cron 刚扫完、用户马上点了刷新」这类重叠调用。
 */
export const RATE_LIMIT_PER_MIN = 75;
export const RATE_WINDOW_MS = 60_000;
