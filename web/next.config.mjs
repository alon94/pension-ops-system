/** @type {import('next').NextConfig} */
const apiBase = process.env.API_BASE ?? 'http://localhost:3000';

const nextConfig = {
  reactStrictMode: true,
  // standalone יוצר server.js מינימלי + node_modules רק עם מה שצריך — נדרש ל-Docker
  output: 'standalone',
  async rewrites() {
    // ה-UI פונה ל-/api/... — Next מנתב ל-NestJS על פורט 3000 (ללא CORS בדפדפן)
    return [{ source: '/api/:path*', destination: `${apiBase}/:path*` }];
  },
};

export default nextConfig;
