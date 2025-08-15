/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // If you want the whole app at https://www.essential.radio/player
  // uncomment the next line:
  // basePath: '/player',
  experimental: { serverActions: { allowedOrigins: ['*'] } }
};
module.exports = nextConfig;
