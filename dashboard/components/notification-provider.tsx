'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface NotificationItem {
  type: string;
  title: string;
  body: string;
}

interface CheckResponse {
  new_leads: number;
  new_handoffs: number;
  items: NotificationItem[];
}

// Short beep as base64 WAV (~0.1s 440Hz sine)
const BEEP_DATA_URI =
  'data:audio/wav;base64,UklGRiQBAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQABAABYf3h/eH9hf0V/Jn8Hf+l+zX60fqB+kH6Gfol+kH6efrl+2X7+fiZ/Tn95f6R/zH/xfxGAK4A/gEuAT4BLgD+AK4ARAPPY0H+kf3R/QH8Kf9J+mn5kfjN+CH7kfcl9tn2tfbB9vX3Vffh9JH5YfpV+2H4hf24/vn8PgGCAr4D7gEOBhYG/gfCBFoIxgj6CPYIugg==';

function playBeep() {
  try {
    const audio = new Audio(BEEP_DATA_URI);
    audio.volume = 0.3;
    audio.play().catch(() => {});
  } catch {
    // Audio not available
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check support & current permission
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  const checkNotifications = useCallback(async () => {
    // Skip if tab is hidden
    if (document.hidden) return;

    try {
      const res = await fetch('/api/notifications/check');
      if (!res.ok) return;
      const data: CheckResponse = await res.json();

      for (const item of data.items) {
        const key = `${item.type}-${item.title}`;
        if (seenKeysRef.current.has(key)) continue;
        seenKeysRef.current.add(key);

        // Keep set from growing unbounded
        if (seenKeysRef.current.size > 200) {
          const entries = Array.from(seenKeysRef.current);
          seenKeysRef.current = new Set(entries.slice(-100));
        }

        if (Notification.permission === 'granted') {
          new Notification(item.title, {
            body: item.body,
            icon: '/favicon.ico',
            tag: key,
          });
          playBeep();
        }
      }
    } catch {
      // Network error, skip silently
    }
  }, []);

  // Polling
  useEffect(() => {
    if (permission === 'unsupported') return;

    // Initial check after short delay
    const timeout = setTimeout(checkNotifications, 3000);

    intervalRef.current = setInterval(checkNotifications, 30_000);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [permission, checkNotifications]);

  const showBanner = permission === 'default' && !bannerDismissed;

  return (
    <>
      {showBanner && (
        <div className="mx-4 mt-3 mb-0 flex items-center justify-between gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <svg
              className="h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
              />
            </svg>
            <span>Activez les notifications pour recevoir les alertes de nouvelles soumissions.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={requestPermission}
              className="rounded-md bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 transition"
            >
              Activer
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-amber-500/60 hover:text-amber-400 transition"
              aria-label="Fermer"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
