import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title:       'Novus Epoxy Admin',
  description: 'Dashboard administrateur Novus Epoxy',
  manifest:    '/manifest.json',
  appleWebApp: {
    capable:           true,
    statusBarStyle:    'black-translucent',
    title:             'NE Admin',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
