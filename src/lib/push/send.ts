import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

export interface PushPayload {
  title: string;
  body: string;
  /** 点击通知后跳转的地址，带语言前缀 */
  url: string;
  /** 同 tag 的通知会互相覆盖，避免同一个提醒堆一屏 */
  tag?: string;
}

export interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
  failed_count: number;
}

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT 未配置");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/** 连续失败到这个次数就删掉订阅行，避免失效端点越积越多、每次群发都白跑 */
const MAX_FAILURES = 3;

export async function sendToSubscriptions(
  rows: SubscriptionRow[],
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  if (rows.length === 0) return { sent: 0, removed: 0 };
  configure();

  const supabase = createServiceRoleClient();
  const doomed: string[] = [];
  const recovered: string[] = [];
  let sent = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          JSON.stringify(payload),
          {
            // urgency 不传时库默认 "normal"——安卓息屏进 Doze 后（恰恰是
            // 「应用关着、手机在兜里」的场景）FCM 会把 normal 优先级的推送
            // 攒着批量延迟投递，晚几分钟到几十分钟都有可能。这里发的全是
            // 时效性内容（警报刚触发、价格刚穿线），晚到等于没到。
            // high 的代价是多耗一点电，但这是用户明确开启的交易警报，值得。
            urgency: "high",
            // 默认 TTL 是四周：手机关机几天再开，会补投一条几天前的旧警报，
            // 而过时的警报补发反而有害（价格早就走完了）。一小时是平衡点——
            // 电梯/地铁里断网几分钟仍能收到，隔夜的直接由推送服务丢弃。
            TTL: 3600,
          }
        );
        sent += 1;
        if (row.failed_count > 0) recovered.push(row.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404 / 410 是端点已失效的标准信号：用户卸载了应用或清了数据
        if (status === 404 || status === 410) {
          doomed.push(row.id);
          return;
        }
        // 5xx / 429 记一次失败。不重试当次——价格提醒过时后补发反而有害
        if (row.failed_count + 1 >= MAX_FAILURES) {
          doomed.push(row.id);
        } else {
          // 这次 update 自己也会 reject（DB 抖动、连接池满）。裸着写的话它
          // 会从 map 的回调里抛出去，Promise.all 立刻整体 reject：**其余所有
          // 订阅行的结果全部作废**——doomed 的删除和 recovered 的归零都不执行，
          // 已经发成功的 sent 计数也随函数一起消失。而这个函数的调用方之一是
          // /api/push/test，那个原始 DB 错误会一路回显到设置页上给用户看。
          // 计错一次失败计数远比这轻：吞掉，记日志，计数照走。
          try {
            await supabase
              .from("push_subscriptions")
              .update({ failed_count: row.failed_count + 1 })
              .eq("id", row.id);
          } catch (updateError) {
            console.error("[push/send] failed_count update failed", row.id, updateError);
          }
        }
      }
    })
  );

  if (doomed.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", doomed);
  }
  if (recovered.length > 0) {
    await supabase.from("push_subscriptions").update({ failed_count: 0 }).in("id", recovered);
  }

  return { sent, removed: doomed.length };
}

export async function sendToUser(userId: string, payload: PushPayload): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale, failed_count")
    .eq("user_id", userId);
  await sendToSubscriptions((data ?? []) as SubscriptionRow[], payload);
}

/** 取所有开启了某类通知的订阅。用于选币榜单与新内容广播。 */
export async function getOptedInSubscriptions(
  pref: "screener" | "new_content"
): Promise<SubscriptionRow[]> {
  const supabase = createServiceRoleClient();
  const { data: prefs } = await supabase
    .from("notification_prefs")
    .select("user_id")
    .eq(pref, true);
  const userIds = (prefs ?? []).map((p) => (p as { user_id: string }).user_id);
  if (userIds.length === 0) return [];

  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale, failed_count")
    .in("user_id", userIds);
  return (data ?? []) as SubscriptionRow[];
}
