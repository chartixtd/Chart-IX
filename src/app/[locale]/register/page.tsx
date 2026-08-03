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

export default function RegisterPage() {
  const t = useTranslations("auth.register");
  const locale = useLocale();
  const router = useRouter();
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
      <div className="hero-ground grain flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
        <Card className="w-full max-w-md text-center shadow-card-lg" padding="lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-gold">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <h1 className="mt-5 font-display text-2xl tracking-tight text-text-primary">{t("title")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{success}</p>
          <Link href={`/${locale}/login`} className="mt-7 inline-block">
            <Button variant="outline">{t("login_link")}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="hero-ground grain flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="password"
            type="password"
            label={t("password_label")}
            hint={t("password_hint")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            id="confirmPassword"
            type="password"
            label={t("confirm_password_label")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            error={error}
          />

          <Button type="submit" className="w-full" loading={loading}>
            {t("submit")}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-text-secondary">
          {t("has_account")}{" "}
          <Link href={`/${locale}/login`} className="text-gold hover:underline">
            {t("login_link")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
