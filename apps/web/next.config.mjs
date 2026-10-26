/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@spiceos/contracts'],
  poweredByHeader: false,
};
export default nextConfig;
