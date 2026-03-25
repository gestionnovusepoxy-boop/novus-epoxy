import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',            value: 'DENY' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security',  value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-XSS-Protection',           value: '1; mode=block' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
  disableLogger: true,
  automaticVercelMonitors: true,
});
