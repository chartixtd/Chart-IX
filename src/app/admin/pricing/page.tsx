import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { PricingEditor } from "./PricingEditor";
import { PricingHeading } from "./PricingHeading";

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
    return <div className="text-danger">Error loading pricing: {error.message}</div>;
  }

  return (
    <div>
      <PricingHeading />
      <PricingEditor pricing={(pricing ?? []) as PricingConfig[]} />
    </div>
  );
}
