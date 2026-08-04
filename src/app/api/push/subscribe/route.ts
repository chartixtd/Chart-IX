import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// web-push 需要 node:crypto，不能跑在 Edge runtime 上
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  locale: z.string().min(2).max(10),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // request.json() throws a raw SyntaxError on a malformed or empty body, which would
  // escape as a generic Next.js 500 instead of a clean 400.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const { endpoint, keys, locale } = parsed.data;

  // endpoint 唯一：同一台设备重新订阅时更新而非插入，
  // 顺带把 failed_count 归零、刷新 locale（用户可能换了语言）
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      locale,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      failed_count: 0,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
