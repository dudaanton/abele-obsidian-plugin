export type SyncNamePlatform = 'windows' | 'android' | 'macos' | 'linux' | 'ios'

/** Host admission only. Wire names and server files are never rewritten. */
export function unsupportedSyncName(path: string, platform: SyncNamePlatform): string | null {
  if (platform !== 'windows' && platform !== 'android') return null
  for (const segment of path.split('/')) {
    const forbidden = segment.match(/[:*?"<>|]/)?.[0]
    if (forbidden) return forbidden
    if (/[. ]$/.test(segment)) return 'trailing dot or space'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) return 'reserved device name'
  }
  return null
}
