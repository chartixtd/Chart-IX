import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// 60s per-user cache of the admin-gate lookup. Trade-off (documented in the
// perf spec §4): revoking admin / disabling an account can take up to 60s to
// bite in an already-warm edge instance. getUser() itself stays uncached.
const roleCache = new Map<string, { role: string | null; disabled: boolean; at: number }>();
const ROLE_TTL_MS = 60_000;

async function getAdminProfile(userId: string) {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit;
  const { data } = await createServiceRoleClient()
    .from("users").select("role, is_disabled").eq("id", userId).single();
  const entry = { role: data?.role ?? null, disabled: Boolean(data?.is_disabled), at: Date.now() };
  roleCache.set(userId, entry);
  return entry;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin 路由：不经过 i18n 中间件
  if (pathname.startsWith("/admin")) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (pathname === "/admin/login") {
      // 已登录的 admin 重定向到后台首页
      if (user) {
        const profile = await getAdminProfile(user.id);

        if (profile.role === "admin") {
          return NextResponse.redirect(new URL("/admin", request.url));
        }
      }
      return NextResponse.next();
    }

    // 未登录 → 重定向到 admin 登录页
    if (!user) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    // 非 admin → 重定向到首页
    const profile = await getAdminProfile(user.id);

    if (profile.role !== "admin") {
      const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value || routing.defaultLocale;
      return NextResponse.redirect(new URL(`/${cookieLocale}`, request.url));
    }

    if (profile.disabled) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    return NextResponse.next();
  }

  // 静态资源 + Next.js 元数据路由 (favicon/OG 图, 定义在 src/app/ 根目录, 不带 locale 前缀)
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/logo") ||
    pathname.match(/^\/(icon|apple-icon|opengraph-image|twitter-image)(\.[a-z0-9]+)?$/) ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt" ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|ico|webp)$/)
  ) {
    return NextResponse.next();
  }

  // 根路径重定向到用户偏好的语言（cookie > accept-language > 默认）
  if (pathname === "/") {
    const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
    const acceptLang = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0];
    const targetLocale = cookieLocale || (acceptLang && routing.locales.find(l => l.startsWith(acceptLang))) || routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${targetLocale}`, request.url));
  }

  return intlMiddleware(request);
}

// /api is excluded via the negative lookahead below (not just the removed
// pathname.startsWith("/api") branch that used to live above) — the old
// broad "/((?!_next|_vercel|.*\\..*).*)" pattern still matches /api/* (no
// dot, doesn't start with _next/_vercel), so without excluding it here too,
// every /api request would fall through this function all the way to
// intlMiddleware() and get incorrectly treated as needing locale routing.
// Excluding it here also means this edge function no longer wakes for
// nothing on every poll (BingX market data, trading account, etc. all hit
// /api every few seconds per open tab). Each /api/admin/* route already
// gates itself via requireAdmin() — see src/lib/supabase/admin-auth.ts.
export const config = {
  matcher: ["/((?!_next|_vercel|api|.*\\..*).*)", "/"],
};
