import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { TradingLimitsEditor } from "./TradingLimitsEditor";
import { AdminPageHeading } from "../AdminPageHeading";

export const dynamic = "force-dynamic";

export interface TradingLimitRow {
  id: string;
  user_id: string | null;
  max_notional_per_order: number | null;
  max_orders_per_day: number | null;
  max_leverage: number | null;
  allowed_symbols: string[] | null;
  updated_at: string;
}

export default async function AdminTradingLimitsPage() {
  const client = createServiceRoleClient();

  const { data: rows, error } = await client
    .from("trading_limits")
    .select(
      "id, user_id, max_notional_per_order, max_orders_per_day, max_leverage, allowed_symbols, updated_at"
    )
    .order("user_id", { ascending: true, nullsFirst: true });

  return (
    <div>
      <AdminPageHeading
        titleKey="trading_limits_list.title"
        resource="trading limits"
        errorMessage={error?.message}
      />
      {!error && <TradingLimitsEditor rows={(rows ?? []) as TradingLimitRow[]} />}
    </div>
  );
}
