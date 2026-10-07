import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import {
  selectionMenu,
  selectionMenuScriptsFrom,
  selectionMenuPlace,
  withSelectionScript,
  withoutSelectionScript,
  movedSelectionScript,
} from '@/scripting/selectionMenuScripts'
import { bookMenu } from '@/scripting/bookMenuScripts'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { applyEntries, buildPayload, collectEntries } from '@/transfer/entries'
import { useVault } from '../helpers/testEnv'
import type { ParsedScript } from '@/scripting/types'

const parsed = (header: string): ParsedScript => ({
  path: 'Scripts/sample.js',
  code: '',
  commandId: '',
  meta: parseScriptHeader(header)!,
})
const scripts = [
  parsed('// @name Book only\n// @book\n// @icon book'),
  parsed('// @name Chat only\n// @chat-selection\n// @icon message-square'),
  parsed('// @name Both\n// @book\n// @chat-selection'),
  parsed('// @name Plain\n// @icon languages'),
]

describe('independent selection menus', () => {
  it('opts in to chats explicitly, without changing book or interceptor metadata', () => {
    expect(scripts[0].meta.chatSelection).toBeUndefined()
    expect(scripts[1].meta.chatSelection).toBe(true)
    expect(scripts[1].meta.book).toBeUndefined()
    expect(scripts[1].meta.interceptor).toBeUndefined()
    expect(selectionMenu(scripts, [], 'chat').map((i) => i.script)).toEqual(['Both', 'Chat only'])
    expect(bookMenu(scripts, []).map((i) => i.script)).toEqual(['Book only', 'Both'])
    expect(
      parseScriptHeader('// @name Plain\n// @chat-selection-extra')?.chatSelection
    ).toBeUndefined()
  })

  it('uses surface-local order and overrides before sorted headers, without duplicates or missing scripts', () => {
    const books = [{ script: 'Plain', name: 'Book label', icon: 'star' }]
    const chats = [
      { script: 'Chat only', name: 'Chat label', icon: 'pin' },
      { script: 'Plain', name: ' ', icon: '' },
      { script: 'Plain', name: 'Ignored', icon: 'x' },
      { script: 'Missing', name: '', icon: '' },
    ]
    expect(selectionMenu(scripts, chats, 'chat')).toEqual([
      { script: 'Chat only', label: 'Chat label', icon: 'pin', by: 'setting' },
      { script: 'Plain', label: 'Plain', icon: 'languages', by: 'setting' },
      { script: 'Both', label: 'Both', icon: 'scroll-text', by: 'header' },
    ])
    expect(selectionMenu(scripts, books, 'book')[0].label).toBe('Book label')
    expect(selectionMenu(scripts, [], 'chat').some((i) => i.label === 'Book label')).toBe(false)
    expect(selectionMenu([scripts[1], scripts[1]], [], 'chat')).toHaveLength(1)
  })

  it('normalizes legacy and malformed lists, and pins/unpins/moves without mutating them', () => {
    expect(selectionMenuScriptsFrom(null)).toEqual([])
    const list = selectionMenuScriptsFrom([
      null,
      'Plain',
      { script: ' Plain ' },
      { script: 'Plain' },
      { script: '' },
      { script: 'Both', name: 4, icon: false },
    ])
    expect(list).toEqual([
      { script: 'Plain', name: '', icon: '' },
      { script: 'Both', name: '', icon: '' },
    ])
    expect(withSelectionScript(list, 'Plain')).toBe(list)
    expect(withSelectionScript(list, 'Chat only')[2]).toEqual({
      script: 'Chat only',
      name: '',
      icon: '',
    })
    expect(movedSelectionScript(list, 1, -1).map((i) => i.script)).toEqual(['Both', 'Plain'])
    expect(movedSelectionScript(list, 0, -1)).toBe(list)
    expect(withoutSelectionScript(list, 'Plain').map((i) => i.script)).toEqual(['Both'])
    expect(selectionMenuPlace(scripts[0], list, 'chat')).toBeNull()
    expect(selectionMenuPlace(scripts[1], list, 'chat')).toBe('header')
    expect(selectionMenuPlace(scripts[2], list, 'chat')).toBe('setting')
    expect(DEFAULT_AI_SETTINGS.chatSelectionScripts).toEqual([])
  })
})

describe('selection menu persistence and transfer', () => {
  beforeEach(() => useVault([]))

  it('loads old settings with an empty chat list, normalizes incoming lists, and preserves book choices', async () => {
    const config = AbeleConfig.getInstance()
    const plugin = {
      loadData: vi
        .fn()
        .mockResolvedValue({
          reader: { selectionScripts: [{ script: 'Plain', name: 'Book', icon: 'book' }] },
          ai: { chatSelectionScripts: [{ script: ' Both ' }, { script: 'Both' }] },
        }),
      saveData: vi.fn().mockResolvedValue(undefined),
    }
    config.init(plugin as never)
    await config.loadSettings()
    expect(config.ai.chatSelectionScripts).toEqual([{ script: 'Both', name: '', icon: '' }])
    expect(config.reader.selectionScripts[0].name).toBe('Book')
    plugin.loadData.mockResolvedValue({ ai: {} })
    await config.loadSettings()
    expect(config.ai.chatSelectionScripts).toEqual([])
  })

  it.each(['merge', 'replace'] as const)(
    'round trips both menus through JSON in %s mode without credentials or unrelated changes',
    (mode) => {
      const source = {
        ai: {
          chatSelectionScripts: [
            { script: 'Both', name: 'Chat', icon: 'message-square' },
            { script: 'Plain', name: '', icon: '' },
          ],
        },
        reader: {
          ...DEFAULT_READER_SETTINGS,
          selectionScripts: [{ script: 'Plain', name: 'Book', icon: 'book' }],
        },
      } as AbeleSettings
      const entries = collectEntries(source).filter(
        (e) => e.section === 'scripts' || e.section === 'reader'
      )
      const payload = JSON.parse(JSON.stringify(buildPayload(entries, null)))
      expect(payload.secrets).toEqual({})
      expect(entries.every((e) => !e.secretIds?.length)).toBe(true)
      const destination = {
        ai: { chatFolder: 'Conversations', providers: [{ id: 'sample-provider' }] },
        tasksFolder: 'Tasks',
        links: [{ id: 'sample-link' }],
      } as AbeleSettings
      const result = applyEntries(payload.entries, destination, mode)
      expect(result.ai.chatSelectionScripts).toEqual(source.ai.chatSelectionScripts)
      expect(selectionMenu(scripts, result.ai.chatSelectionScripts, 'chat')).toEqual(
        selectionMenu(scripts, source.ai.chatSelectionScripts, 'chat')
      )
      expect(bookMenu(scripts, result.reader.selectionScripts)).toEqual(
        bookMenu(scripts, source.reader.selectionScripts)
      )
      expect(result.ai.chatFolder).toBe('Conversations')
      expect(result.ai.providers).toEqual(destination.ai.providers)
      expect(result.links).toEqual(destination.links)
      expect(result.tasksFolder).toBe('Tasks')
      expect(destination.ai.chatSelectionScripts).toBeUndefined()
    }
  )
})
