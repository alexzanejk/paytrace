import { useCallback, useState } from "react";

const KEY = "pt-theme";

/** Light by default; the choice to use dark is remembered in this browser only (if storage is blocked it simply is not remembered). */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // private window or blocked storage: the choice just lasts until the page is closed
    }
    setDark(next);
  }, []);
  return { dark, toggle };
}
