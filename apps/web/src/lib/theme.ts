import { useEffect, useState } from "react";

// Light or dark Cream Ledger theme, set on <html> by the page's ThemeToggle and remembered across reloads.

export type Theme = "light" | "dark";
const KEY = "xrpl-lending:theme";

// Storage can throw (private windows, blocked site data); then the system setting decides each visit.
function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* fall through */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* keep it for this visit only */ }
    return () => { delete root.dataset.theme; };
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
