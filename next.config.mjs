/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
  outputFileTracingIncludes: { '/api/seoul-signs': ['./data/signs/**'], '/api/accidents/radius': ['./node_modules/@sparticuz/chromium/bin/**', './node_modules/playwright-core/**'] },
  async headers() {
    return [{
      source: "/indicator/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }];
  },
};

export default nextConfig;
