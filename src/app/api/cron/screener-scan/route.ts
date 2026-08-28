import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runScan, listVolumeRefreshCoins } from "@/lib/screener/pipeline";
import { isScanDue, writeScannerCache } from "@/lib/screener/cache";
import { pushNewAlerts, readPushedKeys } from "@/lib/screener/alert-push";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildScreenerAlertMessage } from "@/lib/push/messages";
import { readVolumeCache, pickStaleCoins, refreshVolumeBatch, VOLUME_REFRESH_BATCH } from "@/lib/screener/volume-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 一轮完整扫描实测约 22 秒。60 是 Vercel Hobby 的上限，不能再高。
export const maxDuration = 60;

const JOB_NAME = "screener-scan";

export async function GET(request: NextRequest) {
  const auth = await authorizeCronTick(request.headers.get("authorization"), JOB_NAME);
  if (!auth.ok) {
    return NextResponse.json({ error: "Too many ticks", retryAfterMs: auth.retryAfterMs }, { status: auth.status });
  }

  // 触发器每 5 分钟打一次而扫描间隔是 15 分钟，所以三次里有两次不该扫描。
  // 那两跳此前直接走人，现在拿去轮转刷新全池成交量缓存——扫描那一跳因此
  // 不必再逐币调 pairs-markets，成交量门槛得以在**全池**生效而不是只对
  // 已经选中的那二十个生效（完整理由见 migration 050 与 volume-cache.ts）。
  //
  // 放在同一个路由里而不是新开一条 cron 调度，是为了让「扫描」和「刷成交量」
  // 天然互斥：两件事都要打 CoinGlass，各自都会吃掉大半个每分钟配额，
  // 而两条独立的调度没有任何机制保证它们不会撞在同一分钟里。
  if (!(await isScanDue())) {
    try {
      const coins = await listVolumeRefreshCoins();
      const stale = pickStaleCoins(coins, await readVolumeCache(), VOLUME_REFRESH_BATCH);
      const refreshed = await refreshVolumeBatch(stale);
      return NextResponse.json({ skipped: true, reason: "not due", volumeRefreshed: refreshed });
    } catch (err) {
      // 刷新失败不该记成 5xx：这一跳本来就不是扫描，失败的代价只是
      // 某些币的成交量再旧 5 分钟，下一跳会因为它们仍然最旧而重试。
      console.error("[cron/screener-scan] volume refresh failed", err);
      return NextResponse.json({ skipped: true, reason: "not due", volumeRefreshed: 0 });
    }
  }

  try {
    // 卡片现在是扫描的产出之一，不再需要一套「开/更新/关」的状态机：
    // runScan 内部按当轮结果算出 cards，并把新出现的结构事件记进备忘表。
    const payload = await runScan();
    await writeScannerCache(payload);

    // 推送失败不该让整轮扫描记成失败——榜单已经算好并落库了，
    // 那才是这个路由的主产出。推送是附加动作。
    //
    // T25 起这里是 scanner 唯一的推送出口：原先「每 4 小时发一张排行榜」那条
    // 走 telegram-push cron 的路已经删掉，改成「扫描出新警报卡就发那几张卡」。
    // 触发点必须落在扫描这一步——只有这里知道哪些卡片是**这一轮新出现的**。
    // 已推送台账的快照，**必须在 pushNewAlerts 之前取**。
    //
    // 台账是 Telegram 那一路写的：投递成功后 deliverAlerts 会把这一批 key 记
    // 进去。等它跑完再读，读到的就已经包含**当轮**这批卡了——下面的过滤会把
    // fresh 清成空集，Telegram 每成功一次就顺带把 Web Push 静音一次。
    // 在这里取快照，集合的含义才是想要的那个：「**往轮**已经推过的 key」。
    //
    // readPushedKeys 自己吞掉所有异常并返回空集合，所以这一行不会抛，
    // 失败时下面退化成不过滤（现状行为）。
    const pushedBefore =
      payload.newCards.length > 0 ? await readPushedKeys() : new Set<string>();

    let push: Awaited<ReturnType<typeof pushNewAlerts>> = {
      pushed: 0,
      held: 0,
      delivered: false,
      skippedReason: "nothing_new",
    };
    try {
      push = await pushNewAlerts(payload);
    } catch (err) {
      console.error("[cron/screener-scan] alert push failed", err);
    }

    // Web Push 扇出：只发给自己勾了 screener 的订阅者，跟 Telegram 的群配置
    // 是两套东西。它原先挂在 telegram-push cron 的定时窗口上，那个窗口随榜单
    // 推送一起删了，所以搬到同一个事件上来——「有新警报卡就通知」对两个通道
    // 是同一句话。失败不影响扫描结果，也不影响 Telegram 那一路。
    //
    // 这里必须自己过一遍已推送台账，不能直接信 payload.newCards。newCards 的
    // 「新」来自备忘表（cards-store）：那张表读失败时它记一条 "all cards will
    // look brand new" 就返回空 map，于是**当轮全部活跃卡**都会被算成新卡。
    // Telegram 那一路靠台账挡住了这一下（pushNewAlerts 内部过滤），Web Push
    // 这一路没有，结果是一次 DB 抖动就给每个订阅者推一条「N 个新信号」，
    // 里面全是他昨天就看过的卡。
    //
    // 读台账而不是挂到 pushNewAlerts 的返回值上：那样 Telegram 的总开关
    // （settings.enabled）会顺带静音 Web Push，而这是两个必须各自独立的通道。
    // 用上面那份**快照**，理由见 pushedBefore 处的注释。
    try {
      const fresh = payload.newCards.filter((c) => !pushedBefore.has(c.key));
      if (fresh.length > 0) {
        const subscriptions = await getOptedInSubscriptions("screener");
        // 逐行发而不是一次群发：文案要按每台设备订阅时存下的 locale 生成，
        // 而推送在用户看不见页面时弹出，没法临时问客户端要语言
        await Promise.all(
          subscriptions.map((row) =>
            sendToSubscriptions([row], {
              ...buildScreenerAlertMessage(row.locale, fresh),
              url: `/${row.locale}/screener`,
              tag: "screener",
            })
          )
        );
      }
    } catch (err) {
      console.error("[cron/screener-scan] web push fan-out failed", err);
    }

    return NextResponse.json({
      rows: payload.rows.length,
      cards: payload.cards.length,
      newCards: payload.newCards.length,
      pushed: push.pushed,
      held: push.held,
      skipped: push.skippedReason,
    });
  } catch (error) {
    console.error("[cron/screener-scan]", error);
    // 500 让调度器把这次 run 记成失败（可见性），下一个 tick 会自愈重试。
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
