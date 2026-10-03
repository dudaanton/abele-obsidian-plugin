/** Existing binary-size presentation; deliberately keeps MB even above one gigabyte. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Whole minutes; row and summary padding remain an explicit consumer policy. */
export function formatDuration(seconds: number, padMinutes = false): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${padMinutes ? String(minutes).padStart(2, '0') : minutes}m`
  return `${minutes}m`
}

export function formatTokenCount(
  value: number,
  options: { decimals?: number; uppercase?: boolean; millions?: boolean } = {}
): string {
  if (options.millions && value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000)
    return `${(value / 1000).toFixed(options.decimals ?? 1)}${options.uppercase ? 'K' : 'k'}`
  return String(value)
}

/** Not CSV: no quoting, sorting or deduplication. */
export function parseCommaList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Caller supplies a local-day difference, not elapsed milliseconds or UTC dates. */
export function relativeDayLabel(dayDifference: number): string {
  return dayDifference === 0
    ? 'Today'
    : dayDifference === -1
      ? 'Yesterday'
      : dayDifference === 1
        ? 'Tomorrow'
        : ''
}
