import type { NextConfig } from "next";

/**
 * CMIRS — Production Security Headers
 *
 * The application is deployed behind TLS and serves authenticated, role-gated pages.
 * Without an explicit policy the browser applies no transport, framing or content-type
 * protections of its own. The headers below are applied to every response, including the
 * static asset routes that the proxy matcher does not cover.
 *
 * `Content-Security-Policy` is deliberately restrictive for everything the application
 * does not need, while still permitting the Next.js hydration bootstrap (which is an
 * inline script) and the Supabase REST/Storage/Auth origins the client talks to.
 *
 * NOTE FOR THE OWNER: a nonce-based CSP (`script-src 'nonce-…'`) is stronger than the
 * `'unsafe-inline'` allowance used here, because it removes the need for
 * `'unsafe-inline'`. It requires the proxy to mint a nonce per request and to attach it
 * to the request headers so the Next.js renderer can echo it onto its bootstrap scripts.
 * That is recorded as an open item in `docs/PRODUCTION_READINESS_AUDIT.md`.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let supabaseOrigin = "";
let supabaseWsOrigin = "";

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    supabaseOrigin = parsed.origin;
    supabaseWsOrigin = `${parsed.protocol === "http:" ? "ws:" : "wss:"}//${parsed.host}`;
  } catch {
    // An unparsable URL leaves the origins empty; the CSP then restricts connections to
    // the application origin only, which fails closed rather than open.
    supabaseOrigin = "";
    supabaseWsOrigin = "";
  }
}

const connectSources = ["'self'", supabaseOrigin, supabaseWsOrigin]
  .filter((value) => value.length > 0)
  .join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `connect-src ${connectSources}`,
  `img-src 'self' blob: data: ${supabaseOrigin}`.trim(),
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Next.js emits an inline bootstrap script for hydration. `'unsafe-inline'` is required
  // until the nonce-based policy described above is implemented.
  "script-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  /* config options here */
  // Do not advertise the framework in the response headers.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    agentFeedback: true,
    serverActions: {
      // The default Server Action body limit is 1 MB. Report photo attachments are uploaded
      // through the `uploadReportAttachmentAction` Server Action, one file per request, and the
      // server-side validator caps a file at 10 MB (`MAX_ATTACHMENT_BYTES` in
      // utils/reports/validation.ts). 12 MB accommodates one maximum-size file plus the
      // multipart framing overhead.
      //
      // The report-submission action itself never carries file bytes: the photo picker is
      // rendered outside the report form so the selected images are not submitted with it.
      bodySizeLimit: '12mb',
    },
    // Next.js buffers the request body in memory whenever a proxy (this project's `proxy.ts`)
    // is configured, and the default buffer limit is 10 MB. A body above the limit is
    // TRUNCATED, which corrupts a multipart upload and surfaces as "Unexpected end of form"
    // rather than a clean rejection. This must be at least as large as
    // `serverActions.bodySizeLimit` and larger than the 10 MB per-attachment cap.
    proxyClientMaxBodySize: '12mb',
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
