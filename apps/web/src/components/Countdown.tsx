import { useEffect, useState } from "react";
import { secondsUntil } from "../lib/format";

/** Used for the deposit window and "loans open at": "4m 05s", then "now". */
export function Countdown({ to }: { to: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = secondsUntil(to);
  if (s === null) return null;
  if (s <= 0) return <span>now</span>;
  return <span className="num">{Math.floor(s / 60)}m {String(s % 60).padStart(2, "0")}s</span>;
}
