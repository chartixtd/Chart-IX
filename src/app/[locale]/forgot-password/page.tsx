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
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center" padding="lg">
          <div className="mb-4 text-3xl">📧</div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t("success")}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
      <Card className="w-full max-w-sm" padding="lg">
        <h1 className="text-center text-xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-center text-sm text-text-secondary">{t("description")}</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
