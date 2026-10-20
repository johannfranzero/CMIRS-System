import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeRedirectUrl } from "@/utils/auth/validation";

/**
 * Next.js Proxy — Supabase session refresh and route perimeter guard.
 *
 * This proxy runs on every matched request and:
 * 1. Refreshes the Supabase auth token if it has expired, keeping the user's
 *    session alive across Server Components.
 * 2. Enforces route-level perimeter authentication:
 *    - Unauthenticated requests to protected routes redirect to /login?next=...
 *    - Authenticated requests to /login redirect to the dashboard or safe return URL.
 * 3. Never redirects to arbitrary external destinations (uses sanitizeRedirectUrl).
 * 4. Propagates refreshed session cookies to redirect responses.
 *
 * Note: Next.js 16 renamed the `middleware` file convention to `proxy`.
 * The exported function must be named `proxy` (not `middleware`).
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // If env vars are missing, skip Supabase session refresh and pass through.
  // This allows the app to start even before credentials are configured.
  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: Do not add logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/');

  // 1. Unauthenticated user trying to access a protected route
  if (!user && !isPublicRoute) {
    const rawTarget = pathname + request.nextUrl.search;
    const safeTarget = sanitizeRedirectUrl(rawTarget, '/');
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    redirectUrl.searchParams.set('next', safeTarget);

    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Copy any refreshed cookies to the redirect response
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  // 2. Authenticated user trying to access the login page
  if (user && isPublicRoute && pathname === '/login') {
    const nextParam = request.nextUrl.searchParams.get('next');
    const safeDestination = sanitizeRedirectUrl(nextParam, '/');
    const redirectUrl = new URL(safeDestination, request.nextUrl.origin);

    // Prevent redirect loop: if safeDestination is a public auth route, default to '/'
    if (
      redirectUrl.pathname === '/login' ||
      redirectUrl.pathname.startsWith('/login/') ||
      redirectUrl.pathname === '/auth' ||
      redirectUrl.pathname.startsWith('/auth/')
    ) {
      redirectUrl.pathname = '/';
      redirectUrl.search = '';
    }

    const redirectResponse = NextResponse.redirect(redirectUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - /_next/static  (static files)
     * - /_next/image   (image optimization files)
     * - /favicon.ico   (favicon)
     * - paths ending in static asset extensions (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
