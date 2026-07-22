import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { PricingEditor } from "./PricingEditor";

export const dynamic = "force-dynamic";

interface PricingConfig {
  id: number;
  plan_type: string;
  price: number;
  original_price: number | null;
  currency: string;
  currency_symbol: string;
  is_active: boolean;
  updated_at: string;
}

export default async function AdminPricingPage() {
  const client = createServiceRoleClient();

  const { data: pricing, error } = await client
    .from("pricing_config")
    .select("*")
    .order("plan_type", { ascending: true });

  if (error) {
    return <div className="text-red-400">Error loading pricing: {error.message}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Pricing</h1>
      <PricingEditor pricing={(pricing ?? []) as PricingConfig[]} />
    </div>
  );
}
