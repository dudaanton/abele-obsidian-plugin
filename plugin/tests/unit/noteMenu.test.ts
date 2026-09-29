import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Menu, TFile, TFolder, type Plugin } from 'obsidian'
import { registerNoteMenu } from '@/commands/noteMenu'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const titles = [
  'Add to agent context',
  'Chat about this',
  'Attach to a chat',
  'Attach a chat to note',
  'Copy wikilink',
]
const handlers = new Map<string, (...args: any[]) => void>()
const commands: any[] = []
let file: TFile
let active: TFile | null
const editor = { getSelection: () => '' }

beforeEach(() => {
  const app = useVault([{ path: 'Notes/sample-note.md', content: 'Sample text' }])
  file = app.vault.getAbstractFileByPath('Notes/sample-note.md') as TFile
  active = file
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true }
  handlers.clear()
  commands.length = 0
  registerNoteMenu({
    app: {
      workspace: {
        on: (name: string, fn: (...args: any[]) => void) => handlers.set(name, fn),
        getActiveFile: () => active,
        getActiveViewOfType: () => null,
        getMostRecentLeaf: () => null,
      },
    },
    registerEvent: () => {},
    addCommand: (command: any) => commands.push(command),
  } as unknown as Plugin)
})

describe('one ordered set of note actions', () => {
  it.each(['file-explorer-context-menu', 'tab-header', 'more-options'])(
    '%s offers the same five actions',
    (source) => {
      const menu = new Menu()
      handlers.get('file-menu')!(menu, file, source)
      expect(menu.items.map((item) => item.title)).toEqual(titles)
      expect(menu.items.every((item) => !!item.icon)).toBe(true)
    }
  )

  it('offers the same actions in the editor, even without selected text', () => {
    const menu = new Menu()
    handlers.get('editor-menu')!(menu, editor, { file })
    expect(menu.items.map((item) => item.title)).toEqual(titles)
  })

  it('offers copying without AI and does not offer note actions on a folder', () => {
    AbeleConfig.getInstance().ai.enabled = false
    const menu = new Menu()
    handlers.get('editor-menu')!(menu, editor, { file })
    expect(menu.items.map((item) => item.title)).toEqual(['Copy wikilink'])
    const folder = new Menu()
    handlers.get('file-menu')!(folder, new TFolder())
    expect(folder.items).toEqual([])
  })

  it('keeps command ids and uses the same visible names', () => {
    const ids = [
      'add-to-agent-context',
      'chat-about-current-note',
      'attach-note-to-chat',
      'attach-chat-to-current-note',
      'copy-note-wikilink',
    ]
    expect(ids.map((id) => commands.find((c) => c.id === id)?.name)).toEqual(titles)
    active = null
    expect(commands.every((c) => !c.checkCallback(true))).toBe(true)
  })

  it('copies a wikilink even when generated markdown links would be used', async () => {
    const app = GlobalStore.getInstance().app
    ;(app.metadataCache as any).fileToLinktext = vi.fn(() => 'Notes/sample-note')
    ;(app as any).fileManager = {
      generateMarkdownLink: () => '[sample-note](Notes/sample-note.md)',
    }
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const menu = new Menu()
    handlers.get('file-menu')!(menu, file, 'more-options')
    menu.items.at(-1)!.handler!()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('[[Notes/sample-note]]'))
    expect(app.metadataCache.fileToLinktext).toHaveBeenCalledWith(file, '')
    vi.unstubAllGlobals()
  })
})
