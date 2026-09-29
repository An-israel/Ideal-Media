/** Formats a duration in seconds as "45 min" / "1h 12m" / "—" when unknown. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "Length unknown";
  const total = Math.round(seconds);
  // Under a minute, report seconds — rounding 45s up to "1 min" is a small lie.
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes} min`;
}

/** Formats seconds as a clock — "7:05" / "1:07:05". */
export function formatClock(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
