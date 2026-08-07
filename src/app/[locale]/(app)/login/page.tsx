"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes("fetch") || authError.message.includes("ENOTFOUND")) {
          setError("Supabase not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
        } else {
          setError(authError.message);
        }
        setLoading(false);
        return;
      }
    } catch {
      setError("Supabase not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
      setLoading(false);
      return;
    }

    router.push(`/${locale}`);
    router.refresh();
  };

  return (
    <div className="hero-ground grain flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md shadow-card-lg" padding="lg">
        <div className="text-center">
          <Image src="/logo.png" alt="Chart-IX" width={240} height={160} priority className="mx-auto h-11 w-auto" />
          <h1 className="mt-5 font-display text-3xl tracking-tight">
            <span className="text-text-primary">Chart</span>
            <span className="text-gold">-IX</span>
          </h1>
          <div className="hairline-gold mx-auto mt-4 w-14" />
          <p className="mt-4 text-sm text-text-secondary">{t("subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input
            id="email"
            type="email"
            label={t("email_label")}
            placeholder={t("email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="password"
            type="password"
            label={t("password_label")}
            placeholder={t("password_placeholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            {t("submit")}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link href={`/${locale}/forgot-password`} className="text-gold hover:underline">
            {t("forgot_password")}
          </Link>
        </div>

        <div className="mt-4 text-center text-sm text-text-secondary">
          {t("no_account")}{" "}
          <Link href={`/${locale}/register`} className="text-gold hover:underline">
            {t("register_link")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
