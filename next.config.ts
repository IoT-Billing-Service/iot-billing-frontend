import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ];
  },
  experimental: {
    webpackBuildWorker: true,
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...((config.optimization.splitChunks as Record<string, unknown>)?.cacheGroups as Record<
            string,
            unknown
          >),
          stellar: {
            test: /[\\/]node_modules[\\/](@stellar[\\/]|bignumber\.js)/,
            name: 'stellar-vendor',
            chunks: 'all',
            priority: 20,
          },
        },
      };
    }
    return config;
  },
};

export default withBundleAnalyzer(nextConfig);
