"use client";

import { useScrollReveal } from "@/hooks/useScrollReveal";

/**
 * 挂在服务端页面里的零渲染客户端组件——它只负责在 Persuade / Read 面启动
 * GSAP 滚动编排。交易终端与后台不要引入它。
 */
export function ScrollReveal() {
  useScrollReveal();
  return null;
}
