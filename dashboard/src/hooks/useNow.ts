import { useEffect, useState } from "react";

/** The current time, refreshed on a timer, so "Online / Offline" and "2 min ago" keep moving without a page reload. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
