"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClient } from "@/lib/supabase/client";
import { AuthShell, AuthLink } from "@/components/auth/AuthShell";

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
    <AuthShell
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <>
          {t("no_account")} <AuthLink href={`/${locale}/register`}>{t("register_link")}</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-8">
        <Input
          id="email"
          type="email"
          variant="line"
          autoComplete="email"
          label={t("email_label")}
          placeholder={t("email_placeholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          id="password"
          type="password"
          variant="line"
          autoComplete="current-password"
          label={t("password_label")}
          placeholder={t("password_placeholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-5 pt-2">
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {t("submit")}
          </Button>
          <AuthLink href={`/${locale}/forgot-password`}>
            <span className="text-xs uppercase tracking-[0.14em]">{t("forgot_password")}</span>
          </AuthLink>
        </div>
      </form>
    </AuthShell>
  );
}
