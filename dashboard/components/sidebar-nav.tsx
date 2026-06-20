'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavSection {
  title: string;
  links: { href: string; label: string; icon: string }[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Principal',
    links: [
      { href: '/dashboard/mission-control', label: 'Mission Control', icon: '🚀' },
      { href: '/dashboard',            label: 'Vue d\'ensemble', icon: '\u{1F4CA}' },
      { href: '/dashboard/calendrier', label: 'Calendrier',      icon: '\u{1F4C5}' },
    ],
  },
  {
    title: 'Ventes',
    links: [
      { href: '/dashboard/soumissions',label: 'Soumissions',     icon: '\u{1F4CB}' },
      { href: '/dashboard/devis',    label: 'Devis',      icon: '\u{1F4DD}' },
      { href: '/dashboard/factures', label: 'Factures',   icon: '\u{1F9FE}' },
      { href: '/dashboard/crm',      label: 'CRM Leads', icon: '\u{1F4C7}' },
      { href: '/dashboard/travaux',  label: 'Rapport projet',   icon: '\u{1F528}' },
      { href: '/dashboard/sous-traitance', label: 'Sous-traitance', icon: '\u{1F91D}' },
    ],
  },
  {
    title: 'Clients',
    links: [
      { href: '/dashboard/clients',  label: 'Clients',    icon: '\u{1F465}' },
      { href: '/dashboard/emails', label: 'Emails',       icon: '\u{1F4E7}' },
      { href: '/dashboard/textos', label: 'Textos',       icon: '\u{1F4F1}' },
    ],
  },
  {
    title: 'Finances',
    links: [
      { href: '/dashboard/comptabilite', label: 'Comptabilit\u00e9', icon: '\u{1F4B0}' },
      { href: '/dashboard/depenses',     label: 'D\u00e9penses',     icon: '\u{1F4B3}' },
      { href: '/dashboard/banque',       label: 'Banque',       icon: '\u{1F3E6}' },
    ],
  },
  {
    title: 'IA',
    links: [
      { href: '/dashboard/marcel',     label: 'Marcel IA',       icon: '🤖' },
    ],
  },
  {
    title: 'Équipe',
    links: [
      { href: '/dashboard/equipe', label: 'Équipe & Heures', icon: '👷' },
    ],
  },
  {
    title: 'Outils',
    links: [
      { href: '/dashboard/automatisation', label: 'Automatisation', icon: '\u{2699}\u{FE0F}' },
      { href: '/dashboard/integrations', label: 'Intégrations', icon: '\u{1F517}' },
      { href: '/dashboard/campagnes', label: 'Campagnes', icon: '\u{1F4E2}' },
      { href: '/dashboard/pubs', label: 'Pubs Facebook', icon: '\u{1F525}' },
      { href: '/dashboard/stats',  label: 'Statistiques', icon: '\u{1F4C8}' },
      { href: '/dashboard/portfolio', label: 'Portfolio', icon: '\u{1F4F8}' },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
      {SECTIONS.map(section => (
        <div key={section.title}>
          <p className="text-slate-500 text-[10px] uppercase tracking-widest font-semibold px-3 pt-1 pb-1.5 first:pt-1 [&:not(:first-child)]:pt-4">
            {section.title}
          </p>
          {section.links.map(({ href, label, icon }) => {
            const isExternal = href.startsWith('http');
            const cls = `flex items-center gap-3 px-3 py-2 rounded-lg transition text-sm ${
              !isExternal && isActive(href)
                ? 'bg-slate-700 text-white font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`;
            if (isExternal) return (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                <span>{icon}</span><span>{label}</span>
                <svg className="w-3 h-3 ml-auto text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>
            );
            return (
              <Link key={href} href={href} className={cls}>
                <span>{icon}</span><span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
