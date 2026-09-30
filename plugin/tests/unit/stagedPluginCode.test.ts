import { describe, expect, it } from 'vitest'
import type { ChangeItem } from '@abele/sync-protocol'
import { codePluginIds, pluginCodeNames } from '@/sync/stagedPluginCode'
import type { App } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import { sha256 } from '@abele/sync-core'

const change = (path: string, prev_path: string | null = null): ChangeItem =>
  ({ path, prev_path, op: 'modify' }) as ChangeItem

describe('the separate plugin code lane', () => {
  it.each(['main.js', 'manifest.json', 'styles.css', 'lib/helper.js'])(
    'reviews %s, including new folders',
    (file) => {
      expect(codePluginIds(change(`.obsidian/plugins/sample/${file}`), 'abele')).toEqual(['sample'])
    }
  )
  it.each([
    '.obsidian/plugins/sample/data.json',
    '.obsidian/community-plugins.json',
    '.obsidian/plugins/abele/main.js',
    '.obsidian/plugins/abele/data.json',
    'Notes/main.js',
  ])('does not change the settings rules for %s', (path) => {
    expect(codePluginIds(change(path), 'abele')).toEqual([])
  })
  it('reviews both ends of moves, including code renamed to data.json', () => {
    expect(
      codePluginIds(
        change('.obsidian/plugins/new/main.js', '.obsidian/plugins/old/main.js'),
        'abele'
      )
    ).toEqual(['new', 'old'])
    expect(
      codePluginIds(
        change('.obsidian/plugins/sample/data.json', '.obsidian/plugins/sample/main.js'),
        'abele'
      )
    ).toEqual(['sample'])
    expect(
      codePluginIds(change('Notes/copied.js', '.obsidian/plugins/sample/main.js'), 'abele')
    ).toEqual(['sample'])
  })
  it('case folds code paths and the own-plugin exception', () => {
    expect(codePluginIds(change('.OBSIDIAN/PLUGINS/sample/MAIN.JS'), 'abele')).toEqual(['sample'])
    expect(codePluginIds(change('.obsidian/plugins/ABELE/main.js'), 'abele')).toEqual([])
  })
  it('falls back to the folder for invalid metadata, without evaluating it', async () => {
    const bytes = new TextEncoder().encode('not a manifest')
    const sha = await sha256(bytes)
    const app = {
      vault: {
        configDir: '.obsidian',
        adapter: {
          exists: async () => false,
          readBinary: async () => {
            throw new Error('missing')
          },
        },
      },
    } as unknown as App
    const client = { getBlob: async () => bytes } as unknown as VaultClient
    expect(
      await pluginCodeNames(
        app,
        client,
        [{ ...change('.obsidian/plugins/sample/manifest.json'), sha }],
        'abele'
      )
    ).toEqual({ sample: 'sample — New' })
  })
})
