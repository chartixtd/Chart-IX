"use client";

import { useEffect } from "react";
import { usePwaStore } from "@/stores/pwa";

export function ServiceWorkerRegistrar() {
  const setUpdateReady = usePwaStore((s) => s.setUpdateReady);
  const registerApplyUpdate = usePwaStore((s) => s.registerApplyUpdate);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const version = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    let registration: ServiceWorkerRegistration | null = null;
    let reloading = false;

    // 新 SW 接管后重新加载，让页面跑在新代码上
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(`/sw.js?v=${version}`, { scope: "/" })
      .then((reg) => {
        registration = reg;

        registerApplyUpdate(() => {
          reg.waiting?.postMessage({ type: "SKIP_WAITING" });
        });

        // 已经有 waiting 的（上次没点更新就关掉了页面）
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // controller 存在说明这是「更新」而非「首次安装」，
            // 首次安装不该打扰用户
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      })
      .catch((error) => {
        // SW 是增强而非前提：隐私模式、老浏览器、企业策略都可能注册失败，
        // 这里只上报，绝不阻塞渲染
        console.warn("[pwa] service worker registration failed", error);
      });

    // 装成 App 之后会话可能挂好几天不刷新，不主动检查就永远拿不到更新
    const onVisibility = () => {
      if (document.visibilityState === "visible") registration?.update();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [setUpdateReady, registerApplyUpdate]);

  return null;
}
