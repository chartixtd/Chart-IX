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
    // 首次访问时页面还没有 controller；SW 装好后 self.clients.claim() 会让
    // 这个未受控的页面变成受控页面，同样触发 controllerchange。这不是「新版本
    // 接管旧版本」，只是「首次安装接管无主页面」，不该刷新——否则每个新访客
    // 都会在打开页面几秒后被强制刷新一次，正在填的表单会被清空。
    const hadController = Boolean(navigator.serviceWorker.controller);

    // 新 SW 接管后重新加载，让页面跑在新代码上（仅当之前已有 controller，
    // 即这确实是一次版本更新，而非首次安装的 claim()）
    const onControllerChange = () => {
      if (!hadController || reloading) return;
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
