"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { LANGUAGE_LABELS, PUBLIC_LOCALES } from "@/lib/constants";
import { NotificationSettings } from "@/components/settings/NotificationSettings";

/**
 * 设置页的分节骨架：左栏是粘性标题，右栏是内容，顶边一条发丝线。
 * 卡片在这里传达不了层级——四张同宽同色的盒子上下排就只是四个盒子。
 */
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-8 border-t border-border-default pt-10 lg:grid-cols-12 lg:gap-10">
      <h2 className="font-display text-lg font-medium tracking-tight text-text-primary lg:col-span-3 lg:sticky lg:top-24 lg:self-start">
        {title}
      </h2>
      <div className="lg:col-span-9">{children}</div>
    </section>
  );
}

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
      <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
        {/* 骨架照着分节骨架的形状摆：左栏窄标题 + 右栏内容，
            不是三个整宽灰块——形状对不上就会在数据到位时跳一下 */}
        <Skeleton className="h-10 w-56" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-14 grid gap-8 lg:grid-cols-12 lg:gap-10">
            <Skeleton className="h-5 w-28 lg:col-span-3" />
            <div className="space-y-3 lg:col-span-9">
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-11 w-full max-w-sm" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!auth.userId) {
    return (
      <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
        <p className="text-text-muted">{t("please_login")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
      <PageHeader title={t("title")} className="border-b-0 pb-0" />

      <div className="mt-14 space-y-16">
        {/* 账户 */}
        <SettingsSection title={t("profile")}>
          <dl className="grid gap-8 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="eyebrow">{t("email")}</dt>
              <dd className="mt-3 break-all text-sm text-text-primary">{auth.email ?? ""}</dd>
            </div>
            <div>
              <dt className="eyebrow">{t("role")}</dt>
              <dd className="mt-3 text-sm capitalize text-text-primary">{profileQuery.data?.role ?? "-"}</dd>
            </div>
            <div>
              <dt className="eyebrow">{t("tier")}</dt>
              <dd className="mt-3 text-sm">
                {profileQuery.data?.tier === "pro" ? (
                  <Badge variant="foil">{profileQuery.data.tier}</Badge>
                ) : (
                  <span className="text-text-primary">{profileQuery.data?.tier ?? "-"}</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-10 max-w-sm">
            <Input
              id="displayName"
              type="text"
              variant="line"
              label={t("display_name")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={(auth.email ?? "").split("@")[0]}
            />
          </div>
          {message && (
            <p className={cn("mt-4 text-sm", message === t("saved") ? "text-success" : "text-danger")}>
              {message}
            </p>
          )}
          <Button onClick={saveProfile} disabled={saving} className="mt-8 w-full sm:w-auto">
            {saving ? t("saving") : t("save")}
          </Button>
        </SettingsSection>

        {/* 语言 */}
        <SettingsSection title={t("language")}>
          <div className="flex flex-wrap gap-3">
            {PUBLIC_LOCALES.map((l) => (
              <Button
                key={l}
                // 选中态用描边而不是实心金：这一栏是「我选了哪个」，不是这一屏的
                // 主操作。同屏已经有一块实心金（保存），第二块会把它稀释掉。
                variant={profileQuery.data?.language === l ? "outline" : "secondary"}
                size="sm"
                onClick={() => saveLanguage(l)}
              >
                {LANGUAGE_LABELS[l] ?? l}
              </Button>
            ))}
          </div>
        </SettingsSection>

        {/* 交易所密钥 */}
        <SettingsSection title={t("api_keys")}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md break-words text-sm leading-relaxed text-text-secondary">
              {t("api_keys_desc")}
            </p>
            <Button
              variant="outline"
              onClick={() => router.push(`/${locale}/settings/api-keys`)}
              className="w-full shrink-0 sm:w-auto"
            >
              {t("api_keys")}
            </Button>
          </div>
        </SettingsSection>

        <NotificationSettings />
      </div>
    </div>
  );
}
