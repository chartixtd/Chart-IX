import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserTier } from "./access";

/**
 * 读取用户等级（服务端）。
 *
 * 与 access.ts 分开是为了不把 supabase 依赖拖进客户端包 —— access.ts 是纯函数，
 * 两端共用；取数只发生在服务端。
 *
 * 读不到时返回 "free" 而不是 null：所有 canX() 判断都是「Pro 才放行」，
 * 未知等级按最低权限处理，一次读表失败不会意外放开实盘下单。
 */
export async function getUserTier(
  supabase: SupabaseClient,
  userId: string
): Promise<UserTier> {
  const { data } = await supabase.from("users").select("tier").eq("id", userId).single();
  return data?.tier === "pro" ? "pro" : "free";
}
