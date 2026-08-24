"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { LANGUAGE_LABELS, PUBLIC_LOCALES } from "@/lib/constants";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const supabase = createClient();
  const auth = useAuth();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const profileQuery = useQuery({
    queryKey: ["settings", "profile", auth.userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("display_name, language, tier, role")
        .eq("id", auth.userId as string)
        .single();
      if (error) throw new Error(error.message);
      return data as { display_name: string | null; language: string; tier: string; role: string };
    },
    enabled: !!auth.userId,
    staleTime: 5 * 60_000,
    // Key is split by userId — never show one user's profile as a
    // placeholder for another (account switch / cross-tab session sync).
    placeholderData: undefined,
  });

  // Tracks whether displayName has been hydrated from the server at least
  // once for the *current* user. `displayName === ""` is not a reliable
  // "untouched" signal — a user who clears the field to save an empty name,
  // then triggers a re-render (e.g. clicking a language button, which calls
  // setQueryData and produces a new data object reference) would have their
  // just-cleared input silently overwritten back to the old value. A ref
  // avoids re-hydrating after the first sync, and is reset on user switch so
  // the new user's profile gets hydrated once.
  const profileHydratedRef = useRef(false);

  useEffect(() => {
    profileHydratedRef.current = false;
  }, [auth.userId]);

  useEffect(() => {
    if (profileQuery.data && !profileHydratedRef.current) {
      profileHydratedRef.current = true;
      setDisplayName(profileQuery.data.display_name ?? "");
    }
  }, [profileQuery.data]);

  const saveProfile = async () => {
    if (!auth.userId) return;
    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("users")
      .update({ display_name: displayName || null })
      .eq("id", auth.userId);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(t("saved"));
      queryClient.setQueryData(
        ["settings", "profile", auth.userId],
        (prev: { display_name: string | null; language: string; tier: string; role: string } | undefined) =>
          prev ? { ...prev, display_name: displayName || null } : prev
      );
      auth.refresh();
    }
    setSaving(false);
  };

  const saveLanguage = async (lang: string) => {
    if (!auth.userId) return;
    await supabase.from("users").update({ language: lang }).eq("id", auth.userId);
    queryClient.setQueryData(
      ["settings", "profile", auth.userId],
      (prev: { display_name: string | null; language: string; tier: string; role: string } | undefined) =>
        prev ? { ...prev, language: lang } : prev
    );
    router.refresh();
  };

  // profileQuery.isPending 也并入骨架分支：否则昵称/角色/等级会先渲染
  // 空占位再跳变成真实值。查询依赖 userId（enabled），所以只在已登录时看它。
  if (auth.loading || (!!auth.userId && profileQuery.isPending)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-8 h-64 w-full" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }
  if (!auth.userId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
        <p className="text-text-muted">{t("please_login")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
      <h1 className="text-2xl font-bold text-text-primary lg:text-3xl font-display tracking-tight">{t("title")}</h1>

      {/* Profile */}
      <Card className="mt-6 lg:mt-8" padding="lg">
        <h2 className="text-lg font-semibold text-text-primary font-display tracking-tight">{t("profile")}</h2>
        <div className="mt-4 space-y-4">
          {/* 只读展示行：不是表单控件，不用 <label>；label 样式与 Input 的 label 规范对齐 */}
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-text-secondary">
              {t("email")}
            </span>
            <p className="mt-2 break-all text-text-primary">{auth.email ?? ""}</p>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-text-secondary">
              {t("role")}
            </span>
            <p className="mt-2 text-text-primary capitalize">{profileQuery.data?.role ?? "-"}</p>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wider text-text-secondary">
              {t("tier")}
            </span>
            <p className="mt-2 text-text-primary">
              <span className={profileQuery.data?.tier === "pro" ? "text-gold" : ""}>
                {profileQuery.data?.tier ?? "-"}
              </span>
            </p>
          </div>
          <Input
            id="displayName"
            type="text"
            label={t("display_name")}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="lg:max-w-sm"
            placeholder={(auth.email ?? "").split("@")[0]}
          />
          {message && (
            <p className={message === t("saved") ? "text-success" : "text-danger"}>
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
        <h2 className="text-lg font-semibold text-text-primary font-display tracking-tight">{t("language")}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {PUBLIC_LOCALES.map((l) => (
            <Button
              key={l}
              variant={profileQuery.data?.language === l ? "primary" : "outline"}
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
            <h2 className="text-lg font-semibold text-text-primary font-display tracking-tight">{t("api_keys")}</h2>
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
