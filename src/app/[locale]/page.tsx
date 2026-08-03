import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/get-auth";
import HomeClient from "./HomeClient";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const auth = await getServerAuth();

  // Signed-in users land on their dashboard — the marketing homepage is only for guests
  if (auth.userId) {
    redirect(`/${locale}/dashboard`);
  }

  return <HomeClient />;
}
