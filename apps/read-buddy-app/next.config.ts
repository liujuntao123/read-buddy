import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fully client-side app: static export feeds the Tauri 2 shell
  // (src-tauri/tauri.conf.json frontendDist ../out). Dev server unchanged.
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
