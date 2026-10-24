import { expect, it } from 'vitest'
import { validatePath } from '@abele/sync-sdk/protocol'
import { unsupportedSyncName } from '@/sync/platformSyncNames'

it.each(['windows', 'android', 'macos', 'linux', 'ios'] as const)(
  'holds OS-specific names only on %s',
  (platform) => {
    for (const path of [
      'Notes/sample:part.md',
      'Notes/sample*.md',
      'Notes/sample?.md',
      'Notes/sample".md',
      'Notes/sample<.md',
      'Notes/sample>.md',
      'Notes/sample|.md',
      'Notes/sample.',
      'Notes/sample ',
      'Notes/CON.md',
      'Notes/lpt1',
    ])
      expect(!!unsupportedSyncName(path, platform)).toBe(
        platform === 'windows' || platform === 'android'
      )
    expect(unsupportedSyncName('Notes/sample.md', platform)).toBeNull()
  }
)
// BUG: D-011 — the pinned core rejects platform-specific names before host admission.
it.fails('BUG: D-011 admits platform-neutral wire names so supported hosts can place them', () => {
  for (const path of ['Notes/sample:part.md', 'Notes/CON.md', 'Notes/sample.', 'Notes/sample '])
    expect(() => validatePath(path)).not.toThrow()
})
