import { useEffect, useRef } from 'react';

export function useScreenWakeLock(enabled = true) {
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled) return;

    let released = false;

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch (e) {
        // Wake lock request failed or not supported
      }
    }

    requestWakeLock();

    return () => {
      if (wakeLockRef.current && !released) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [enabled]);
}
