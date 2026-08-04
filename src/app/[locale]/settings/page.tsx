"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LANGUAGE_LABELS, PUBLIC_LOCALES } from "@/lib/constants";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const supabase = createClient();
  const auth = useAuth();

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<{
    display_name: string | null;
    language: string;
    tier: string;
    role: string;
  } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      setUser({ id: authUser.id, email: authUser.email ?? "" });

      const { data: p } = await supabase
        .from("users")
        .select("display_name, language, tier, role")
        .eq("id", authUser.id)
        .single();

      if (p) {
        setProfile(p);
        setDisplayName(p.display_name ?? "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("users")
      .update({ display_name: displayName || null })
      .eq("id", user.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(t("saved"));
      setProfile((prev) => (prev ? { ...prev, display_name: displayName } : prev));
      auth.refresh();
    }
    setSaving(false);
  };

  const saveLanguage = async (lang: string) => {
    if (!user) return;
    await supabase.from("users").update({ language: lang }).eq("id", user.id);
    setProfile((prev) => (prev ? { ...prev, language: lang } : prev));
    router.refresh();
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
        <p className="text-text-muted">{t("please_login")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
      <h1 className="text-2xl font-bold text-text-primary lg:text-3xl">{t("title")}</h1>

      {/* Profile */}
      <Card className="mt-6 lg:mt-8" padding="lg">
        <h2 className="text-lg font-semibold text-text-primary">{t("profile")}</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm text-text-muted">{t("email")}</label>
            <p className="break-all text-text-primary">{user.email}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">{t("role")}</label>
            <p className="text-text-primary capitalize">{profile?.role ?? "-"}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">{t("tier")}</label>
            <p className="text-text-primary">
              <span className={profile?.tier === "pro" ? "text-gold" : ""}>
                {profile?.tier ?? "-"}
              </span>
            </p>
          </div>
          <div>
            <label htmlFor="displayName" className="text-sm text-text-muted">
              {t("display_name")}
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none lg:max-w-sm"
              placeholder={user.email.split("@")[0]}
            />
          </div>
          {message && (
            <p className={message === t("saved") ? "text-green-400" : "text-red-400"}>
              {message}
            </p>
          )}
          <Button onClick={saveProfile} disabled={saving} className="w-full sm:w-auto">
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </Card>

      {/* Language */}
      <Card className="mt-6" padding="lg">
        <h2 className="text-lg font-semibold text-text-primary">{t("language")}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {PUBLIC_LOCALES.map((l) => (
            <Button
              key={l}
              variant={profile?.language === l ? "primary" : "outline"}
              size="sm"
              onClick={() => saveLanguage(l)}
            >
              {LANGUAGE_LABELS[l] ?? l}
            </Button>
          ))}
        </div>
      </Card>

      {/* API Keys */}
      <Card className="mt-6" padding="lg">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{t("api_keys")}</h2>
            <p className="mt-1 break-words text-sm text-text-secondary">{t("api_keys_desc")}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(`/${locale}/settings/api-keys`)}
            className="w-full sm:w-auto"
          >
            {t("api_keys")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
