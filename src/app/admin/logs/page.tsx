import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { LogsHeading } from "./LogsHeading";
import { LogsTable } from "./LogsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * 审计日志。
 *
 * 原先固定 `.limit(100)` 拉一批，搜索/筛选/分页全在前端对这 100 条做 filter——
 * 第 101 条之后的记录用任何条件都搜不到，而页面上并不会提示你只看到了一个截断的
 * 窗口。现在筛选和分页都下推到数据库，翻页范围由真实总数决定。
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string; q?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const action = sp.action?.trim() || "";
  const q = sp.q?.trim() || "";
  const from = sp.from?.trim() || "";
  const to = sp.to?.trim() || "";

  const client = createServiceRoleClient();

  let query = client
    .from("admin_logs")
    .select("*, users:admin_id(email)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (action) query = query.eq("action", action);
  // q 会被拼进 PostgREST 的 or() 表达式，而 Supabase JS 对 or() 不做参数化。
  // 逗号和括号是该表达式的语法字符，留着会让用户输入改变过滤结构，所以先剔除。
  if (q) {
    const safe = q.replace(/[,()]/g, "");
    if (safe) query = query.or(`action.ilike.%${safe}%,target_type.ilike.%${safe}%`);
  }
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  // 日期选择器给的是当天，范围要含当天全天，所以用次日零点做开区间上界
  if (to) {
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  const { data: logs, count, error } = await query.range(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE - 1
  );

  // 下拉框里的可选动作要覆盖全表，不能只从当前页推断——否则筛到一个动作之后
  // 下拉框里就只剩它自己，没法切回去。
  const { data: actionRows } = await client
    .from("admin_logs")
    .select("action")
    .order("action", { ascending: true });
  const allActions = [...new Set((actionRows ?? []).map((r) => r.action as string))];

  if (error) {
    return <div className="text-danger">Failed to load logs. Please try again later.</div>;
  }

  return (
    <div>
      <LogsHeading />
      <LogsTable
        logs={logs ?? []}
        allActions={allActions}
        total={count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        filters={{ action, q, from, to }}
      />
    </div>
  );
}
