"use client";

import { useEffect, type ReactNode } from "react";
import { MobileHeader } from "./MobileHeader";
import { MobileTabBar } from "./MobileTabBar";

export function MobileShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // iOS 弹出键盘时会整体上推页面，固定在底部的 tab bar 会漂到键盘上方。
    // 把「键盘占了多少高度」写进 CSS 变量，让 tab bar 在有键盘时收起。
    const sync = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${keyboardHeight}px`);
      document.documentElement.classList.toggle("keyboard-open", keyboardHeight > 80);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.classList.remove("keyboard-open");
    };
  }, []);

  return (
    <>
      <MobileHeader />
      {children}
      <MobileTabBar />
    </>
  );
}
