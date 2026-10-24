/** A label over one figure, with an optional grey unit. */
export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className="num">{value}{unit && <small> {unit}</small>}</b>
    </div>
  );
}
