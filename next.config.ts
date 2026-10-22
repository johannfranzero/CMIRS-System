import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
  },  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
