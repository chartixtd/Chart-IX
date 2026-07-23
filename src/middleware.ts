import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin 路由：不经过 i18n 中间件
  if (pathname.startsWith("/admin")) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 用 service_role 查 users 表 (绕过 RLS)
    const serviceClient = createServiceRoleClient();

    if (pathname === "/admin/login") {
      // 已登录的 admin 重定向到后台首页
      if (user) {
        const { data: profile } = await serviceClient
          .from("users")
          .select("role")
          .eq("id", user.id)
          .single();

        if (profile?.role === "admin") {
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
    const { data: profile } = await serviceClient
      .from("users")
      .select("role, is_disabled")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value || routing.defaultLocale;
      return NextResponse.redirect(new URL(`/${cookieLocale}`, request.url));
    }

    if (profile.is_disabled) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    return NextResponse.next();
  }

  // API 路由：不处理
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // 静态资源
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/logo") ||
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

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)", "/", "/(api|trpc)(.*)"],
};
