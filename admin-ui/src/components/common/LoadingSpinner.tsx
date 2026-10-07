export function LoadingSpinner({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="d-flex align-items-center gap-2 text-muted py-3" role="status">
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
