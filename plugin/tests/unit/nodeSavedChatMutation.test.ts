import { afterEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { setup, hash } from '../helpers/nodeAgentFixture'

const remote = vi.hoisted(() => ({ host: undefined as unknown }))
vi.mock('@/ai/tools/node/owner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ai/tools/node/owner')>()),
  nodeAgentHost: async () => remote.host,
}))
let chats: ChatService
let active: import('@/ai/ChatSession').ChatSession | undefined

afterEach(() => {
  active?.destroy()
  vi.restoreAllMocks()
})

it.each(
  (['edit', 'run'] as const).flatMap((access) =>
    ['node_write', 'node_edit'].map((tool) => ({ access, tool }))
  )
)(
  '$tool works in a saved legacy chat with direct $access access and no prior device approval',
  async ({ access, tool: name }) => {
    const app = useVault([])
    AgentRegistry.destroy()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
    ;(ChatService as unknown as { instance: ChatService | null }).instance = null
    chats = ChatService.getInstance()
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    const agent = AgentRegistry.getInstance().create({ name: 'Sample helper' })
    const file = await app.vault.create(
      'sample-chat.abchat',
      JSON.stringify({
        v: 2,
        k: 'meta',
        type: 'abele-chat',
        agentId: agent.id,
        providerId: '',
        modelId: '',
        title: 'Sample chat',
        created: '2026-01-01',
      }) + '\n'
    )
    await chats.openChatFile(file)
    const session = (active = chats.getSessionByFile(file.path)!)
    const fixture = setup('allow-all')
    remote.host = fixture.host
    session.overrides.value.nodeScope = [
      {
        kind: 'target',
        node_id: 'sample-node',
        project_id: 'sample-project',
        target: { kind: 'workspace', workspace_id: 'sample-workspace' },
        access,
      },
    ]
    session.permissionMode.value = 'allow-all'
    await session.saveForRelease()
    expect(session.nodeScopeIdentity).toBeUndefined()
    const tool = session.getTools().find((tool) => tool.name === name)!
    expect(tool).toBeDefined()
    const result = await tool.execute('sample-call', {
      path: 'sample.txt',
      expected_content_id: hash,
      ...(name === 'node_write' ? { text: 'new' } : { old_text: 'old', new_text: 'new' }),
    })
    expect(result.content[0].text).toContain('saved')
    expect(fixture.client.writeFile).toHaveBeenCalledOnce()
    expect(session.nodeScopeIdentity).toBeTruthy()
    expect(await app.vault.read(file)).toContain(session.nodeScopeIdentity!)
  }
)
