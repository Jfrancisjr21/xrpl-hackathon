const positive = new Set(["approved", "active", "paid", "running", "clear", "good"]);
const negative = new Set(["rejected", "defaulted", "flagged", "risk"]);
const warning = new Set(["pending_review", "originating", "impaired", "review", "watch"]);

function statusClass(status: string) {
  if (positive.has(status)) return "status status--positive";
  if (negative.has(status)) return "status status--negative";
  if (warning.has(status)) return "status status--warning";
  return "status status--neutral";
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <span className={statusClass(value)}>{label ?? value.replaceAll("_", " ")}</span>;
}
