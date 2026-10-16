import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** Re-run on a timer while the browser tab is visible. */
  refreshMs?: number;
}

/** Small data loader: runs once, can be refreshed by hand, and never shows a
 *  stale-looking error while a background refresh is in flight. */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[], { refreshMs }: Options = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);

  const run = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await loadRef.current();
      if (!alive.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      if (!quiet) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (!document.hidden) run(true);
    }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, run]);

  return { data, error, loading, refresh: () => run(true) };
}
