import { afterEach, describe, expect, it } from 'vitest'
import { hookAttachmentPaths } from '@/media/attachmentRulesHook'
import { attachmentSettingFor } from '@/media/attachmentRules'
import { ensureAttachmentFolder } from '@/media/attachmentFolder'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

/**
 * Stands in for Obsidian's vault the way its own method works: the setting is read before the
 * first wait, the folder is made and a free name is picked after it.
 */
class SampleVault {
  setting = 'Default files'
  made: string[] = []
  getConfig(key: string): unknown {
    return key === 'attachmentFolderPath' ? this.setting : `other:${key}`
  }
  async getAvailablePathForAttachments(
    basename: string,
    extension: string,
    file: { path: string } | null
  ): Promise<string> {
    let folder = this.getConfig('attachmentFolderPath') as string
    const parent = file?.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
    if (folder.startsWith('./')) folder = [parent, folder.slice(2)].filter(Boolean).join('/')
    if (folder === '/') folder = ''
    await Promise.resolve()
    this.made.push(folder)
    // Something else reading the setting meanwhile sees the real one.
    expect(this.getConfig('attachmentFolderPath')).toBe(this.setting)
    return `${folder ? `${folder}/` : ''}${basename}.${extension}`
  }
}

const rules = [
  { notesFolder: 'Sample Projects', attachmentsFolder: 'Sample Projects/files' },
  { notesFolder: 'Sample Projects/Deep', attachmentsFolder: './images' },
]
const settingFor = (path: string) => attachmentSettingFor(rules, path)
const note = (path: string) => ({ path }) as never

describe('the attachment path hook', () => {
  it('sends the files of a ruled note to its rule folder and the rest to the vault setting', async () => {
    const vault = new SampleVault()
    const undo = hookAttachmentPaths(vault as never, settingFor)
    const call = (path: string | null) =>
      (vault as unknown as SampleVault).getAvailablePathForAttachments(
        'sample-image',
        'png',
        path === null ? null : note(path)
      )
    expect(await call('Sample Projects/a/n.md')).toBe('Sample Projects/files/sample-image.png')
    expect(await call('Sample Projects/Deep/n.md')).toBe(
      'Sample Projects/Deep/images/sample-image.png'
    )
    expect(await call('Elsewhere/n.md')).toBe('Default files/sample-image.png')
    expect(await call(null)).toBe('Default files/sample-image.png')
    expect(vault.getConfig('attachmentFolderPath')).toBe('Default files')
    expect(vault.getConfig('another')).toBe('other:another')
    expect(Object.prototype.hasOwnProperty.call(vault, 'getConfig')).toBe(false)
    undo()
    expect(Object.prototype.hasOwnProperty.call(vault, 'getAvailablePathForAttachments')).toBe(
      false
    )
    expect(await call('Sample Projects/a/n.md')).toBe('Default files/sample-image.png')
  })

  it('passes straight through once undone, even under a wrapper put on top', async () => {
    const vault = new SampleVault() as SampleVault & Record<string, unknown>
    const undo = hookAttachmentPaths(vault as never, settingFor)
    const ours = vault.getAvailablePathForAttachments
    vault.getAvailablePathForAttachments = function (this: SampleVault, ...args) {
      return ours.apply(this, args)
    }
    undo()
    expect(
      await vault.getAvailablePathForAttachments('x', 'png', note('Sample Projects/n.md'))
    ).toBe('Default files/x.png')
  })

  it('leaves the vault alone when Obsidian has no such method', () => {
    const vault = {}
    const undo = hookAttachmentPaths(vault as never, settingFor)
    expect(vault).toEqual({})
    undo()
  })
})

describe("the plugin's own attachment saves", () => {
  afterEach(() => {
    AbeleConfig.getInstance().attachmentRules = []
  })

  it('go to the rule folder of a ruled note, and to the vault setting otherwise', async () => {
    const app = useVault([])
    Object.assign(app.vault, { getConfig: () => 'Default files' })
    AbeleConfig.getInstance().attachmentRules = rules
    expect(await ensureAttachmentFolder(app as never, 'Sample Projects/n.md')).toBe(
      'Sample Projects/files'
    )
    expect(await ensureAttachmentFolder(app as never, 'Sample Projects/Deep/n.md')).toBe(
      'Sample Projects/Deep/images'
    )
    expect(await ensureAttachmentFolder(app as never, 'Elsewhere/n.md')).toBe('Default files')
    expect(await ensureAttachmentFolder(app as never)).toBe('Default files')
  })
})
