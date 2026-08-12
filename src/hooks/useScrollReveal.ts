"use client";

import { useLayoutEffect } from "react";

/**
 * GSAP 滚动入场编排。
 *
 * 只给 Persuade / Read 面用——交易终端与后台不要挂这个 hook，那边一行 GSAP
 * 都不应该下载。gsap 与 ScrollTrigger 都是动态 import，所以未挂载本 hook 的
 * 路由 bundle 里不会出现它们。
 *
 * 用法：在服务端组件里给元素加 data-reveal（可选 data-reveal-delay="120"），
 * 容器加 data-reveal-group 让子元素依次错开入场。
 *
 * 关键顺序：初始态（opacity:0）是在挂载后由本 hook 加 .is-armed 才生效的，
 * 不是写死在 CSS 里。反过来做——默认隐藏、等 JS 显示——会让禁用 JS 的用户
 * 和爬虫拿到一整页空白。这里最坏情况是内容先可见再淡入，不是永远看不见。
 */
export function useScrollReveal(enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal], [data-reveal-group]")
    );
    if (targets.length === 0) return;

    // 同步上锁（在首帧绘制前），避免"先看见、再消失、再淡入"的闪动
    targets.forEach((el) => el.classList.add("is-armed"));

    let cancelled = false;
    let ctx: { revert: () => void } | undefined;

    // 兜底：gsap 因为网络问题没能加载时，把内容放出来，而不是留一页空白
    const failSafe = window.setTimeout(() => {
      targets.forEach((el) => el.classList.remove("is-armed"));
    }, 2500);

    (async () => {
      try {
        const [gsapMod, stMod] = await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;

        const gsap = gsapMod.gsap ?? gsapMod.default;
        const ScrollTrigger = stMod.ScrollTrigger ?? stMod.default;
        gsap.registerPlugin(ScrollTrigger);
        window.clearTimeout(failSafe);

        ctx = gsap.context(() => {
          // 单元素入场
          gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
            const delay = Number(el.dataset.revealDelay ?? 0) / 1000;
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: 0.7,
              delay,
              ease: "expo.out",
              scrollTrigger: { trigger: el, start: "top 88%", once: true },
              onStart: () => el.classList.remove("is-armed"),
            });
          });

          // 分组错开：40ms/项，超过 8 项后收敛，否则末尾几项等太久
          gsap.utils.toArray<HTMLElement>("[data-reveal-group]").forEach((group) => {
            const items = Array.from(group.children) as HTMLElement[];
            group.classList.remove("is-armed");
            gsap.set(items, { opacity: 0, y: 24 });
            gsap.to(items, {
              opacity: 1,
              y: 0,
              duration: 0.65,
              ease: "expo.out",
              stagger: { each: 0.04, from: "start" },
              scrollTrigger: { trigger: group, start: "top 85%", once: true },
            });
          });

          // 视差：只作用于装饰层，永远不碰正文与可交互控件
          gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((layer) => {
            const amount = Number(layer.dataset.parallax ?? -8);
            gsap.to(layer, {
              yPercent: amount,
              ease: "none",
              scrollTrigger: {
                trigger: layer.parentElement ?? layer,
                start: "top bottom",
                end: "bottom top",
                scrub: 0.5,
              },
            });
          });
        });
      } catch {
        targets.forEach((el) => el.classList.remove("is-armed"));
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(failSafe);
      ctx?.revert();
      targets.forEach((el) => el.classList.remove("is-armed"));
    };
  }, [enabled]);
}
