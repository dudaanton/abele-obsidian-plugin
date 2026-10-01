/** Untrusted API and book links may open the web or mail, never an app protocol. */
export function openExternal(address: string, target?: string): boolean {
  const url = address.trim()
  try {
    if (!['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) return false
  } catch {
    return false
  }
  if (target === undefined) window.open(url)
  else window.open(url, target)
  return true
}
