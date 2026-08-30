/** Triggers a browser download of in-memory text content — no navigation, no server round-trip beyond the fetch that already happened. */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(filename, blob);
}

/** Same as downloadTextFile, for a binary Blob already in hand (e.g. a fetched PDF) — no re-fetch, no navigation. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
