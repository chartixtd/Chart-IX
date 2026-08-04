"use client";

import { useEffect, useState } from "react";

/**
 * 离线时交易类按钮必须明确禁用并说明原因。
 * 让用户以为单下出去了，是这套系统最坏的失败模式。
 */
export function useOnlineStatus(): boolean {
  // SSR 与首帧一律按在线处理，避免正常用户看到一闪而过的离线提示
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
