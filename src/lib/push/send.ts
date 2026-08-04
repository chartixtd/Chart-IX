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
          JSON.stringify(payload)
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
          await supabase
            .from("push_subscriptions")
            .update({ failed_count: row.failed_count + 1 })
            .eq("id", row.id);
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
