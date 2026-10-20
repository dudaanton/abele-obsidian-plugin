import { expect, it } from 'vitest'
import { IgnoreRules } from '@abele/sync-sdk/core'
import { syncFixtureRules } from '../e2e/helpers/syncFixtureRules'

it.each(['.obsidian/plugins/abele/sample-review.js', '.obsidian/hotkeys.json'])(
  'allows exactly the configuration fixture %s without exchanging installed code or settings',
  (path) => {
    const rules = IgnoreRules.parse(syncFixtureRules('Sync fixtures sample', [path]))
    expect(rules.ignores(path)).toBe(false)
    expect(rules.ignores('Sync fixtures sample/ordinary.md')).toBe(false)
    for (const other of [
      '.obsidian/plugins/abele/main.js',
      '.obsidian/plugins/abele/data.json',
      '.obsidian/workspace.json',
      '.obsidian/community-plugins.json',
      '.obsidian/plugins/other/main.js',
      'private.md',
    ])
      expect(rules.ignores(other), other).toBe(true)
  }
)
