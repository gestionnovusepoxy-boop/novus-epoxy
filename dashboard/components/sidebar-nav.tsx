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
    ],
  },
  {
    title: 'Clients',
    links: [
      { href: '/dashboard/clients',  label: 'Clients',    icon: '\u{1F465}' },
      { href: '/dashboard/emails', label: 'Emails',       icon: '\u{1F4E7}' },
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
    title: 'Outils',
    links: [
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
          {section.links.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition text-sm ${
                isActive(href)
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span>{icon}</span><span>{label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
