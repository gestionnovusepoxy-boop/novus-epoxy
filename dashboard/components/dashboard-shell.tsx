'use client';

import { useState, ReactNode } from 'react';

interface DashboardShellProps {
  email: string;
  signOutAction: () => Promise<void>;
  sidebar: ReactNode;
  children: ReactNode;
}

export function DashboardShell({ email, signOutAction, sidebar, children }: DashboardShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Overlay on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:sticky top-0 left-0 h-screen z-40
        w-56 bg-slate-800 border-r border-slate-700 flex flex-col
        transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-email.jpg" alt="Novus Epoxy" className="w-10 h-10 rounded-lg" />
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Novus Epoxy</h1>
              <p className="text-amber-400 text-xs mt-0.5 font-medium">Admin</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="md:hidden text-slate-400 hover:text-white text-2xl p-1"
          >
            &times;
          </button>
        </div>

        <div onClick={() => setOpen(false)}>
          {sidebar}
        </div>

        <div className="p-4 border-t border-slate-700 mt-auto">
          <p className="text-slate-500 text-xs truncate mb-3">{email}</p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full text-left text-sm text-slate-400 hover:text-white transition"
            >
              Deconnexion
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar with hamburger */}
        <div className="md:hidden flex items-center gap-3 p-3 bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
          <button
            onClick={() => setOpen(true)}
            className="text-white p-2 hover:bg-slate-700 rounded-lg"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="text-white font-semibold text-sm">Novus Epoxy</span>
        </div>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
