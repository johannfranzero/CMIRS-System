import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js Proxy — Supabase session refresh.
 *
 * This proxy runs on every matched request and refreshes the Supabase
 * auth token if it has expired, keeping the user's session alive across
 * Server Components. Without this, users would be silently logged out when
 * their JWT expires.
 *
 * No route protection or redirects are implemented here — that will be
 * added in a later authentication phase.
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

  // Refreshes the auth token if expired. The result is intentionally unused
  // in this foundation phase — route protection will be added later.
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - /_next/static  (static files)
     * - /_next/image   (image optimization files)
     * - /favicon.ico   (favicon)
     * - paths ending in static asset extensions (svg, png, jpg, jpeg, gif, webp)
     *
     * Note: leading / is required in the lookahead so that /_next/static/…
     * and /favicon.ico are correctly excluded (paths always start with /).
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
