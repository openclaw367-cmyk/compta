export function StatusBadge({ validated }: { validated: boolean }) {
  if (validated) {
    return (
      <span className="inline-flex items-center rounded-full bg-positive-soft px-2 py-0.5 text-[11.5px] font-medium text-positive">
        Validée
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] font-medium text-warning">
      Brouillon
    </span>
  );
}
