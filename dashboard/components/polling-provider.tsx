'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

interface PollingContext {
  lastRefresh: Date | null;
  isRefreshing: boolean;
  refresh: () => void;
}

const Ctx = createContext<PollingContext>({
  lastRefresh:  null,
  isRefreshing: false,
  refresh:      () => {},
});

export function usePolling() {
  return useContext(Ctx);
}

interface Props {
  children:    React.ReactNode;
  onRefresh:   () => Promise<void>;
  intervalMs?: number;
}

export function PollingProvider({ children, onRefresh, intervalMs = 30_000 }: Props) {
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const runningRef  = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const doRefresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRefreshing(true);
    try {
      await onRefresh();
      setLastRefresh(new Date());
    } catch (err) {
      // If session expired, redirect to login
      if (err instanceof Error && err.message.includes('expir')) {
        window.location.href = '/auth/signin';
      }
    } finally {
      runningRef.current = false;
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    doRefresh();

    function startInterval() {
      intervalRef.current = setInterval(() => {
        if (!document.hidden) doRefresh();
      }, intervalMs);
    }

    function handleVisibility() {
      if (document.hidden) {
        clearInterval(intervalRef.current!);
      } else {
        doRefresh();
        startInterval();
      }
    }

    startInterval();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalRef.current!);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [doRefresh, intervalMs]);

  return (
    <Ctx.Provider value={{ lastRefresh, isRefreshing, refresh: doRefresh }}>
      {children}
    </Ctx.Provider>
  );
}
