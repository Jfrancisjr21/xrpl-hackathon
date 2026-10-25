import { useState } from "react";

/** Copies text to the clipboard and says so for a moment. Clipboard access can be refused; it then says that. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState("copied"); }
    catch { setState("failed"); }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button type="button" className="text-button" onClick={copy} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </button>
  );
}
