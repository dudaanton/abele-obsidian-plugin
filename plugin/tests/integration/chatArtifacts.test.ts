import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { artifactsOf, artifactFile } from '@/ai/chatArtifactsAdapter'
import { attachNote, detachNote } from '@/ai/chatNoteLinks'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import type { TFile } from 'obsidian'
import type { AgentTool } from '@/ai/client'
vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))
let app: ReturnType<typeof useVault>
const sessions: ChatSession[] = []
destroyChatsAfterEach()
beforeEach(() => {
  app = useVault([{ path: 'Notes/sample.md', content: 'alpha' }, { path: 'Pictures/sample.png' }])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    scriptsEnabled: true,
    scriptsFolder: 'Scripts',
    chatFolder: 'Chats/{{name}}',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  AgentRegistry.getInstance().setDefault(AgentRegistry.getInstance().create({ name: 'Sample' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})
afterEach(() => {
  sessions.splice(0).forEach((s) => s.destroy())
  vi.restoreAllMocks()
})
function session() {
  const s = new ChatSession(ChatService.getInstance())
  sessions.push(s)
  ChatService.getInstance().adoptSession(s)
  s.scopeResolver.entries.value = [
    { type: 'folder', path: 'Notes' },
    { type: 'folder', path: 'Scripts' },
  ]
  s.permissionMode.value = 'allow-all'
  s.toolModes.value = { ...s.toolModes.value, create_script: 'auto' }
  ;(s as unknown as { allChatMessages: ChatMessage[] }).allChatMessages = [
    { id: 'root', role: 'user', content: 'Sample', timestamp: 1 },
  ]
  return s
}
const tools = (s: ChatSession) => (s as unknown as { getTools(): AgentTool[] }).getTools()
async function edit(s: ChatSession, path: string, old_string: string, new_string: string) {
  await tools(s)
    .find((t) => t.name === 'read')!
    .execute('read', { path })
  await tools(s)
    .find((t) => t.name === 'edit')!
    .execute('edit', { path, old_string, new_string })
}
describe('artifacts over real links and chat loading', () => {
  it('follows attach, save, reload, last-link removal and a later successful write relinking', async () => {
    const s = session()
    await s.save()
    const file = s.currentChatFile.value!
    await attachNote(file.path, 'Notes/sample.md')
    expect(artifactsOf(s).notes[0].sources).toEqual([])
    const reopened = session()
    await reopened.load(file)
    expect(artifactsOf(reopened).notes.map((a) => a.path)).toEqual(['Notes/sample.md'])
    await detachNote(file.path, 'Notes/sample.md')
    const detached = session()
    await detached.load(file)
    expect(artifactsOf(detached).notes).toEqual([])
    expect(
      ChatStorage.getInstance()
        .getHistory()
        .find((e) => e.path === file.path)?.notes
    ).toBeUndefined()
    await edit(detached, 'Notes/sample.md', 'alpha', 'beta')
    await detached.save()
    expect(artifactsOf(detached).notes.map((a) => a.path)).toEqual(['Notes/sample.md'])
    expect(artifactFile('Notes/sample.md')).toBeDefined()
  })
  it('includes script creation and editing, survives reload and disabled execution', async () => {
    const s = session()
    await tools(s)
      .find((t) => t.name === 'create_script')!
      .execute('create', { name: 'sample', content: '// alpha' })
    await edit(s, 'Scripts/sample.js', 'alpha', 'beta')
    await s.save()
    AbeleConfig.getInstance().ai.scriptsEnabled = false
    const reopened = session()
    await reopened.load(s.currentChatFile.value!)
    expect(artifactsOf(reopened).scripts.map((a) => a.path)).toEqual(['Scripts/sample.js'])
    expect(artifactsOf(reopened).notes).toEqual([])
  })
  it.each([1, 2])(
    'loads v%s images from persisted results, including hidden branches, without rewriting',
    async (version) => {
      const snapshot = {
        metadata: {
          type: 'abele-chat' as const,
          providerId: '',
          modelId: '',
          created: '2025-01-01',
          title: 'Sample',
          touched: [{ path: 'Notes/sample.md', at: '2025-01-01' }],
        },
        internalMessages: [],
        messages: [
          {
            id: 'root',
            role: 'user' as const,
            content: 'Sample',
            timestamp: 1,
            attachments: ['Pictures/sample.png'],
          },
          {
            id: 'image',
            parentId: 'root',
            role: 'tool-call' as const,
            content: '',
            timestamp: 2,
            toolStatus: 'approved' as const,
            toolName: 'generate_image',
            toolResult: 'Image saved: Pictures/missing.png',
          },
          {
            id: 'other',
            parentId: 'root',
            role: 'assistant' as const,
            content: 'Another branch',
            timestamp: 3,
          },
        ],
      }
      const raw = version === 1 ? JSON.stringify(snapshot, null, 2) : serializeChat(snapshot)
      expect(parseChat(raw).version).toBe(version)
      const file = (await app.vault.create(`Chats/legacy-${version}.abchat`, raw)) as TFile
      const s = session()
      await s.load(file)
      expect(artifactsOf(s).images.map((a) => a.path)).toEqual([
        'Pictures/sample.png',
        'Pictures/missing.png',
      ])
      expect(artifactFile('Pictures/missing.png')).toBeUndefined()
      expect(artifactsOf(s).images[1].sources[0].messageId).toBe('image')
      expect(await app.vault.read(file)).toBe(raw)
    }
  )
  it('follows note and script rename propagation, but does not guess moved image identities', async () => {
    const s = session()
    await edit(s, 'Notes/sample.md', 'alpha', 'beta')
    await tools(s)
      .find((t) => t.name === 'create_script')!
      .execute('create', { name: 'sample', content: '// sample' })
    ;(s as unknown as { allChatMessages: ChatMessage[] }).allChatMessages.push({
      id: 'image',
      role: 'user',
      content: '',
      timestamp: 2,
      attachments: ['Pictures/sample.png'],
    })
    s.updateVisibleMessages()
    await s.save()
    for (const [from, to] of [
      ['Notes/sample.md', 'Notes/renamed.md'],
      ['Scripts/sample.js', 'Scripts/renamed.js'],
    ]) {
      await app.vault.rename(app.vault.getAbstractFileByPath(from)!, to)
      await ChatStorage.getInstance().handleNoteRename(from, to)
    }
    await app.vault.rename(
      app.vault.getAbstractFileByPath('Pictures/sample.png')!,
      'Pictures/moved.png'
    )
    expect(artifactsOf(s).notes[0].path).toBe('Notes/renamed.md')
    expect(artifactsOf(s).scripts[0].path).toBe('Scripts/renamed.js')
    expect(artifactsOf(s).images[0].path).toBe('Pictures/sample.png')
    expect(artifactFile(artifactsOf(s).images[0].path)).toBeUndefined()
    const reopened = session()
    await reopened.load(s.currentChatFile.value!)
    expect(artifactsOf(reopened)).toEqual(artifactsOf(s))
  })
})
