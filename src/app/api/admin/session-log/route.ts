import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { logAdminAction } from "@/lib/supabase/admin-log";

export const dynamic = "force-dynamic";

/**
 * 记录后台的登录/登出。
 *
 * 补的是审计日志里最基础的一个盲区：原先 26 种 action 覆盖了增删改各类资源，
 * 却唯独没有「谁在什么时候进过后台」——而这恰恰是排查越权操作时第一个要看的。
 *
 * 登录流程本身在客户端（admin/login 直接调 signInWithPassword），所以由客户端
 * 在拿到 admin 身份后回调这里。requireAdmin() 保证只有真正的管理员能写入，
 * 伪造调用写不进别人的记录：admin_id 取自服务端校验过的会话，不读请求体。
 */
const EVENTS = { login: "admin_login", logout: "admin_logout" } as const;

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let event: unknown;
  try {
    ({ event } = await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  if (event !== "login" && event !== "logout") {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  await logAdminAction({
    adminId: auth.user.id,
    action: EVENTS[event],
    targetType: "session",
    targetId: auth.user.id,
    // x-forwarded-for 是代理链，第一段才是客户端真实 IP
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined,
  });

  return NextResponse.json({ success: true });
}
