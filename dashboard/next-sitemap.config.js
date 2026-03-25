/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://novus-epoxy.vercel.app',
  generateRobotsTxt: true,
  exclude: [
    '/dashboard/*',
    '/api/*',
    '/auth/*',
    '/reservation/*',
    '/paiement/*',
    '/contrat/*',
  ],
  robotsTxtOptions: {
    policies: [
      { userAgent: '*', allow: '/', disallow: ['/dashboard', '/api', '/auth'] },
    ],
  },
};
