"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const t = useTranslations("admin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(t("login.invalid_credentials"));
      setLoading(false);
      return;
    }

    if (!authData.user) {
      setError(t("login.invalid_credentials"));
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", authData.user.id)
      .single();

    if (profile?.role !== "admin") {
      setError(t("login.access_denied"));
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    // 审计留痕。失败不阻断登录——记不上日志不该把人挡在门外。
    await fetch("/api/admin/session-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "login" }),
    }).catch(() => {});

    router.push("/admin");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm" padding="lg">
        <h1 className="text-center text-2xl font-bold">
          <span className="gold-text">Chart</span>
          <span className="text-text-primary">-IX</span>
          <span className="ml-2 text-sm text-text-muted">{t("login.title")}</span>
        </h1>
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input
            id="email"
            type="email"
            label={t("login.email_label")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="password"
            type="password"
            label={t("login.password_label")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            {t("login.submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
