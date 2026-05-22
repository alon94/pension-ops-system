/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone יוצר server.js מינימלי + node_modules רק עם מה שצריך — נדרש ל-Docker
  output: 'standalone',
  async rewrites() {
    // קריאה ב-runtime (לא ב-build time) — חיוני ל-Railway/Fly/etc שמזריקים API_BASE
    // רק כשה-container עולה.
    const apiBase = process.env.API_BASE ?? 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${apiBase}/:path*` }];
  },
};

export default nextConfig;
