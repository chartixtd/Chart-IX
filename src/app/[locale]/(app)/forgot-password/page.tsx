"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";

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
      <AuthShell title={t("title")}>
        <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-gold/40 text-gold">
          <Icon name="inbox" className="h-6 w-6" />
        </div>
        <p className="mt-8 text-sm leading-relaxed text-text-secondary">{t("success")}</p>
        <Button variant="outline" size="lg" className="mt-10" onClick={() => router.back()}>
          {t("back_to_login")}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("title")} subtitle={t("description")}>
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
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-3 pt-2">
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {t("submit")}
          </Button>
          <Button type="button" variant="ghost" size="lg" className="w-full" onClick={() => router.back()}>
            {t("back_to_login")}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
