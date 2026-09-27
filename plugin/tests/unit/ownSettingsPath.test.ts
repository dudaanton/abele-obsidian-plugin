/**
 * Where this device's own settings file is, and the join leaving it alone under any spelling.
 *
 * While a device joins a vault its own `data.json` is kept out of the engine, so no create of it
 * carries the side the person chose. The path is the plugin's real folder — Obsidian's
 * `manifest.dir`, which need not be named after the id — and the engine asks about it under the
 * spelling it found on disk, which a case-insensitive disk may give in any case. The settings
 * watch already folds case; the join's exclusion has to match it.
 */
import { describe, it, expect } from 'vitest'
import { ownSettingsPath } from '@/sync/ownSettings'
import { ignoreFor } from '@/sync/scope'

describe("this device's own settings file", () => {
  it('is in the plugin’s own folder, whatever that folder is called', () => {
    expect(ownSettingsPath('.obsidian', { id: 'abele', dir: '.obsidian/plugins/abele-dev' })).toBe(
      '.obsidian/plugins/abele-dev/data.json'
    )
  })

  it('is under the id when the folder is not known', () => {
    expect(ownSettingsPath('.obsidian', { id: 'abele' })).toBe('.obsidian/plugins/abele/data.json')
  })

  it('is left out while joining under any case of its name', () => {
    const matcher = ignoreFor('.obsidian', null, '.obsidian/plugins/Abele/data.json')

    expect(matcher.ignores('.obsidian/plugins/abele/data.json')).toBe(true)
    expect(matcher.ignores('.obsidian/plugins/ABELE/DATA.JSON')).toBe(true)
    expect(matcher.ignores('.obsidian/plugins/other/data.json')).toBe(false)
  })
})
