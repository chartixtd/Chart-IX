"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgot_password");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="hero-ground grain flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
        <Card className="w-full max-w-md text-center shadow-card-lg" padding="lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-gold">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <h1 className="mt-5 font-display text-2xl tracking-tight text-text-primary">{t("title")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t("success")}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="hero-ground grain flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md shadow-card-lg" padding="lg">
        <h1 className="text-center font-display text-2xl tracking-tight text-text-primary">{t("title")}</h1>
        <div className="hairline-gold mx-auto mt-4 w-14" />
        <p className="mt-4 text-center text-sm leading-relaxed text-text-secondary">{t("description")}</p>
        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <Input
            id="email"
            type="email"
            label={t("email_label")}
            placeholder={t("email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            {t("submit")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => router.back()}>
            {t("back_to_login")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
