/**
 * The chat index lives in a file of its own beside `data.json`, not inside it.
 *
 * `data.json` syncs between devices now, and the later save wins. The index was written into it
 * on every new chat, every rename, every summary — so each chat on any device would rewrite the
 * file every other device races against. It moves to `chat-index.json` in the plugin's folder,
 * which no sync carries: Obsidian Sync takes only four files out of a plugin's folder, and Abele
 * Sync takes only `data.json` besides the plugin's code.
 *
 * The move must never lose a chat: the index is written to its own file before the settings
 * file is written without it, and a device that cannot write the index keeps it in the settings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChatStorage } from '@/ai/ChatStorage'
import type { AiChatHistoryEntry } from '@/ai/types'
import type { FakeApp } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

const DIR = '.obsidian/plugins/abele'
const INDEX = `${DIR}/chat-index.json`

let app: FakeApp
let stored: unknown
let saved: Record<string, unknown>[]
/** What reached the disk, in order: `index` for the chat index, `data` for `data.json`. */
let writes: string[]

const chat = (path: string, created = '2026-09-01'): AiChatHistoryEntry => ({
  path,
  title: path.replace(/^.*\//, '').replace(/\.abchat$/, ''),
  created,
})

function install(files: { path: string; content: string }[] = []): AbeleConfig {
  app = useVault([
    { path: `${DIR}/manifest.json`, content: '{}' },
    ...files.map((file) => ({ ...file, mtime: 1000, ctime: 1000 })),
  ])
  saved = []
  writes = []
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  app.vault.adapter.writeBinary = async (path, data, options) => {
    if (path === INDEX) writes.push('index')
    return write(path, data, options)
  }
  const config = AbeleConfig.getInstance()
  config.init({
    app,
    manifest: { id: 'abele', dir: DIR },
    loadData: async () => stored,
    saveData: async (data: unknown) => {
      writes.push('data')
      const copy = JSON.parse(JSON.stringify(data)) as Record<string, unknown>
      saved.push(copy)
      stored = copy
    },
    syncAiFeatures: vi.fn(),
  } as never)
  return config
}

async function indexOnDisk(): Promise<AiChatHistoryEntry[] | null> {
  if (!(await app.vault.adapter.exists(INDEX))) return null
  const text = new TextDecoder().decode(await app.vault.adapter.readBinary(INDEX))
  return (JSON.parse(text) as { chats: AiChatHistoryEntry[] }).chats
}

const chatHistoryIn = (file: unknown): unknown =>
  (file as { ai?: { chatHistory?: unknown } } | undefined)?.ai?.chatHistory

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  ChatStorage.destroy()
})

describe('the first launch of this build', () => {
  it('writes the index out of data.json into its own file first, then data.json without it', async () => {
    stored = { tasksFolder: 'Work', ai: { chatHistory: [chat('AI/Chats/One.abchat')] } }
    const config = install()

    await config.loadSettings()

    expect((await indexOnDisk())?.map((e) => e.path)).toEqual(['AI/Chats/One.abchat'])
    expect(chatHistoryIn(saved.at(-1))).toBeUndefined()
    expect(writes.indexOf('index')).toBeLessThan(writes.indexOf('data'))
    expect(config.ai.chatHistory.map((e) => e.path)).toEqual(['AI/Chats/One.abchat'])
  })

  it('keeps the index in data.json when its own file cannot be written', async () => {
    stored = { tasksFolder: 'Work', ai: { chatHistory: [chat('AI/Chats/One.abchat')] } }
    const config = install()
    app.vault.adapter.writeBinary = async () => {
      throw new Error('EACCES: the disk refused')
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await config.loadSettings()
    config.tasksFolder = 'Projects'
    await config.saveSettings()

    expect(chatHistoryIn(saved.at(-1))).toEqual([chat('AI/Chats/One.abchat')])
    vi.restoreAllMocks()
  })
})

describe('a launch after the move', () => {
  it('reads the index from its own file, and data.json never carries it', async () => {
    stored = { tasksFolder: 'Work' }
    const config = install([
      { path: INDEX, content: JSON.stringify({ chats: [chat('AI/Chats/One.abchat')] }) },
    ])

    await config.loadSettings()
    config.tasksFolder = 'Projects'
    await config.saveSettings()

    expect(config.ai.chatHistory.map((e) => e.path)).toEqual(['AI/Chats/One.abchat'])
    expect(chatHistoryIn(saved.at(-1))).toBeUndefined()
    expect(chatHistoryIn(config.exportSettings())).toBeUndefined()
  })

  it('keeps an index file it cannot read beside it, rather than writing over it', async () => {
    stored = { tasksFolder: 'Work' }
    const config = install([{ path: INDEX, content: '{"chats": [ {"path": "AI/Ch' }])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await config.loadSettings()

    const aside = new TextDecoder().decode(
      await app.vault.adapter.readBinary(`${DIR}/chat-index.broken.json`)
    )
    expect(aside).toBe('{"chats": [ {"path": "AI/Ch')
    vi.restoreAllMocks()
  })

  it('folds in an index an older build wrote into data.json, keeping this device’s entry for a path', async () => {
    stored = {
      tasksFolder: 'Work',
      ai: {
        chatHistory: [
          { ...chat('AI/Chats/One.abchat'), title: 'From the other device' },
          chat('AI/Chats/Two.abchat', '2026-09-02'),
        ],
      },
    }
    const config = install([
      {
        path: INDEX,
        content: JSON.stringify({ chats: [{ ...chat('AI/Chats/One.abchat'), title: 'Mine' }] }),
      },
    ])

    await config.loadSettings()

    const paths = (await indexOnDisk())?.map((e) => [e.path, e.title])
    expect(paths).toEqual([
      ['AI/Chats/Two.abchat', 'Two'],
      ['AI/Chats/One.abchat', 'Mine'],
    ])
    expect(chatHistoryIn(saved.at(-1))).toBeUndefined()
  })
})

describe('a data.json that arrives from another device', () => {
  it('leaves this device’s index as it is', async () => {
    stored = { tasksFolder: 'Work' }
    const config = install([
      { path: INDEX, content: JSON.stringify({ chats: [chat('AI/Chats/One.abchat')] }) },
    ])
    await config.loadSettings()

    stored = { ...(stored as object), tasksFolder: 'Elsewhere' }
    await config.reloadSettings()

    expect(config.tasksFolder).toBe('Elsewhere')
    expect(config.ai.chatHistory.map((e) => e.path)).toEqual(['AI/Chats/One.abchat'])
  })

  it('from an older build, carrying its index, adds the chats this one did not list', async () => {
    stored = { tasksFolder: 'Work' }
    const config = install([
      { path: INDEX, content: JSON.stringify({ chats: [chat('AI/Chats/One.abchat')] }) },
    ])
    await config.loadSettings()

    stored = {
      tasksFolder: 'Work',
      ai: { chatHistory: [chat('AI/Chats/Two.abchat', '2026-09-02')] },
    }
    await config.reloadSettings()

    expect((await indexOnDisk())?.map((e) => e.path)).toEqual([
      'AI/Chats/Two.abchat',
      'AI/Chats/One.abchat',
    ])
    expect(chatHistoryIn(saved.at(-1))).toBeUndefined()
  })
})

describe('the chats', () => {
  it('write a new entry to the index file, and not to data.json', async () => {
    stored = { tasksFolder: 'Work' }
    const config = install()
    await config.loadSettings()
    saved = []
    const settingsSaves = vi.spyOn(config, 'saveSettings')

    ChatStorage.getInstance().addHistoryEntry(chat('AI/Chats/New.abchat'))
    for (let i = 0; i < 5; i++) await settle()

    expect((await indexOnDisk())?.map((e) => e.path)).toEqual(['AI/Chats/New.abchat'])
    expect(settingsSaves).not.toHaveBeenCalled()
    expect(saved).toEqual([])
    vi.restoreAllMocks()
  })

  it('survive settings a transfer applies', async () => {
    stored = { tasksFolder: 'Work' }
    const config = install([
      { path: INDEX, content: JSON.stringify({ chats: [chat('AI/Chats/One.abchat')] }) },
    ])
    await config.loadSettings()

    config.applySettings({ ...config.exportSettings(), tasksFolder: 'Arrived' })

    expect(config.ai.chatHistory.map((e) => e.path)).toEqual(['AI/Chats/One.abchat'])
  })
})
