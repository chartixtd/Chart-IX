import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ endpoint: z.string().url() });

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
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });

  // RLS 已经限制只能删自己的行，这里的 user_id 条件是第二道保险
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}
