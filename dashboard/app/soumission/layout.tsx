import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Soumission gratuite — Novus Epoxy',
  description: 'Obtenez votre soumission gratuite pour plancher epoxy au Quebec. 20% de rabais en avril!',
  openGraph: {
    title: 'Soumission gratuite — Novus Epoxy',
    description: 'Planchers epoxy haut de gamme au Quebec. 20% de rabais en avril! Soumission en moins d\'une heure.',
    type: 'website',
  },
};

export default function SoumissionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
