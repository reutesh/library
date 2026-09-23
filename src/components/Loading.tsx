export default function Loading({ label = 'טוען...' }: { label?: string }) {
  return (
    <div className="loading-state">
      <div className="spinner" />
      {label}
    </div>
  );
}