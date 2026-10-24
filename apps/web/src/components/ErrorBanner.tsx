export function ErrorBanner({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {error} {onRetry && <button type="button" className="text-button" onClick={onRetry}>Retry</button>}
    </div>
  );
}
