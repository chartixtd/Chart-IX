import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

const SELECT_COLS =
  "id, user_id, max_notional_per_order, max_orders_per_day, max_leverage, allowed_symbols, updated_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 空字符串与 undefined 一律落成 NULL——NULL 的语义是「不限制」
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// [] 表示「不允许任何交易对」，null/undefined/"" 表示「不限制」——两者语义不同，不能混淆
function toSymbols(v: unknown): string[] | null {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.map(String) : [];
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

// GET - 列出全局默认（user_id IS NULL）与所有按用户覆盖的限额配置
export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("trading_limits")
      .select(SELECT_COLS)
      .order("user_id", { ascending: true, nullsFirst: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data: { rows: data ?? [] } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PUT - 写入/更新全局默认（userId: null）或某个用户的覆盖配置（userId: uuid）
//
// 020_trading_limits.sql 里全局默认行与用户覆盖行分别由两条部分唯一索引约束：
//   trading_limits_global_uniq ON (user_id IS NULL) WHERE user_id IS NULL
//   trading_limits_user_uniq   ON (user_id)         WHERE user_id IS NOT NULL
// PostgREST 的 `.upsert(..., { onConflict })` 只能生成不带 WHERE 的
// `ON CONFLICT (col)` 子句，这条子句无法匹配一个带谓词的部分索引——Postgres
// 要求 ON CONFLICT 的目标推断能唯一确定一个索引，模糊匹配时会直接报错
// "there is no unique or exclusion constraint matching the ON CONFLICT
// specification"，而不是静默退化成全表 upsert。因此这里改用「先查是否存在同一行，
// 存在则 update、不存在则 insert」的两步写法，对全局行和用户行走同一套逻辑。
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { userId, maxNotionalPerOrder, maxOrdersPerDay, maxLeverage, allowedSymbols } =
      body as Record<string, unknown>;

    if (userId !== null && userId !== undefined && (typeof userId !== "string" || !UUID_RE.test(userId))) {
      return NextResponse.json({ error: "userId must be a UUID string or null" }, { status: 400 });
    }
    const normalizedUserId: string | null = typeof userId === "string" ? userId : null;

    const payload = {
      max_notional_per_order: toNum(maxNotionalPerOrder),
      max_orders_per_day: toNum(maxOrdersPerDay),
      max_leverage: toNum(maxLeverage),
      allowed_symbols: toSymbols(allowedSymbols),
      updated_at: new Date().toISOString(),
    };

    const client = createServiceRoleClient();

    const existingQuery = client.from("trading_limits").select("id");
    const { data: existingRows, error: findError } = normalizedUserId
      ? await existingQuery.eq("user_id", normalizedUserId).limit(1)
      : await existingQuery.is("user_id", null).limit(1);

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    const existingId = (existingRows?.[0] as { id?: string } | undefined)?.id;

    const { data, error } = existingId
      ? await client.from("trading_limits").update(payload).eq("id", existingId).select(SELECT_COLS).single()
      : await client
          .from("trading_limits")
          .insert({ ...payload, user_id: normalizedUserId })
          .select(SELECT_COLS)
          .single();

    if (error) {
      // 23503 = foreign key violation：userId 指向一个不存在的 users 行
      const status = error.code === "23503" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE - 删除某条覆盖配置（含全局默认行）
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const client = createServiceRoleClient();
    const { data, error } = await client.from("trading_limits").delete().eq("id", id).select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
