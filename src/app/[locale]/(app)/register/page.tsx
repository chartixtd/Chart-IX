"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";
import { AuthShell, AuthLink } from "@/components/auth/AuthShell";

export default function RegisterPage() {
  const t = useTranslations("auth.register");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      setError(t("error_password_mismatch"));
      return;
    }

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError(t("error_password_weak"));
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signUp({ email, password });

      if (authError) {
        if (authError.message.includes("already")) {
          setError(t("error_duplicate"));
        } else if (authError.message.includes("fetch") || authError.message.includes("ENOTFOUND")) {
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

    setSuccess(t("success_verify"));
    setLoading(false);
  };

  if (success) {
    return (
      <AuthShell title={t("title")}>
        <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-gold/40 text-gold">
          <Icon name="inbox" className="h-6 w-6" />
        </div>
        <p className="mt-8 text-sm leading-relaxed text-text-secondary">{success}</p>
        <Link href={`/${locale}/login`} className="mt-10 inline-block">
          <Button variant="outline" size="lg">
            {t("login_link")}
          </Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <>
          {t("has_account")} <AuthLink href={`/${locale}/login`}>{t("login_link")}</AuthLink>
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          id="password"
          type="password"
          variant="line"
          autoComplete="new-password"
          label={t("password_label")}
          hint={t("password_hint")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          id="confirmPassword"
          type="password"
          variant="line"
          autoComplete="new-password"
          label={t("confirm_password_label")}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          error={error}
        />

        <div className="pt-2">
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
