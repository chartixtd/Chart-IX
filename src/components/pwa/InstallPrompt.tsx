"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readPlatform, type Platform } from "@/lib/pwa/platform";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const DISMISS_KEY = "chart-ix-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const t = useTranslations("pwa");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setPlatform(readPlatform());

    const onBeforeInstall = (e: Event) => {
      // 拦下浏览器的默认横幅，换成我们自己的解释卡
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setOpen(false);
      localStorage.setItem(DISMISS_KEY, "1");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!platform || platform.isStandalone) return null;
  if (platform.os === "other") return null;

  const isInApp = platform.inAppBrowser !== null;
  // iOS 不触发 beforeinstallprompt，只能给图文说明
  const showIosSteps = platform.os === "ios" && platform.canPromptInstall;
  const showAndroidButton = platform.os === "android" && deferred !== null;

  if (!isInApp && !showIosSteps && !showAndroidButton) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
    setPlatform(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setOpen(false);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-tabbar right-4 z-40 rounded-full border border-gold/35 bg-bg-secondary px-4 py-2 text-xs text-gold shadow-card lg:hidden"
      >
        {isInApp ? t("install_inapp_title") : t("install_action")}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isInApp ? t("install_inapp_title") : t("install_title")}
        size="sm"
      >
        {isInApp ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text-secondary">{t("install_inapp_body")}</p>
            <Button onClick={copyLink} className="w-full">
              {copied ? t("install_inapp_copied") : t("install_inapp_copy")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text-secondary">{t("install_body")}</p>
            {showIosSteps && (
              <ol className="space-y-2 text-sm text-text-secondary">
                {[t("install_ios_step1"), t("install_ios_step2"), t("install_ios_step3")].map(
                  (step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="font-display text-gold">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  )
                )}
              </ol>
            )}
            <div className="flex gap-2">
              {showAndroidButton && (
                <Button onClick={install} className="flex-1">
                  {t("install_action")}
                </Button>
              )}
              <Button variant="ghost" onClick={dismiss} className="flex-1">
                {t("install_dismiss")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
