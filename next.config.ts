import type { NextConfig } from "next";

/**
 * Security headers (AUDIT CFG-1). This file was empty boilerplate, so the app
 * shipped with no CSP, no HSTS and no framing protection while holding members'
 * names, phone numbers, emails and birthdays.
 *
 * The CSP allows what the app actually uses:
 *   - 'unsafe-inline' styles: Tailwind and next-themes inject inline styles
 *   - 'unsafe-inline' scripts: required by Next.js's inline bootstrap
 *   - connect-src https:: the Supabase project URL is per-environment
 *   - img-src data:/blob:: the upload form draws photos to a canvas to downscale
 *   - frame-src youtube: course modules embed YouTube lessons
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  "media-src 'self' https: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Don't advertise the framework version.
  poweredByHeader: false,

  experimental: {
    serverActions: {
      /**
       * Server actions default to a 1MB request body, which is smaller than
       * things this app legitimately posts — an attendance sheet or a photo of
       * a register is capped at 5MB (MAX_UPLOAD_BYTES), so anything over 1MB
       * was failing before it reached the handler.
       *
       * Training media does NOT come through here: those files can be hundreds
       * of megabytes, so they upload straight to Supabase Storage from the
       * browser using a signed upload URL (see prepareTeachingUpload).
       */
      bodySizeLimit: "8mb",
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            // The upload form uses the camera to photograph a paper register.
            value: "camera=(self), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
