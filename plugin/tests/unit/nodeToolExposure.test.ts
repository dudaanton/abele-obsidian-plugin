import { afterEach, expect, it } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createAgent } from '@/ai/agents/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
let session: ChatSession | undefined
afterEach(() => session?.destroy())
it.each(['read', 'edit', 'run'] as const)(
  'offers node tools at %s without recursive permission resolution',
  (access) => {
    useVault([])
    const agent = createAgent({ name: 'Sample helper' })
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [agent],
      defaultAgentId: agent.id,
    }
    session = new ChatSession(ChatService.getInstance())
    session.overrides.value.nodeScope = [{ kind: 'node', node_id: 'sample-node', access }]
    session.permissionMode.value = 'confirm-all'
    const tools = session.getTools().map((tool) => tool.name)
    expect(tools).toContain('node_compare')
    expect(tools).toContain('node_read')
    expect(tools.includes('node_write')).toBe(access !== 'read')
    expect(tools.includes('node_command_run')).toBe(access === 'run')
    expect(session.getToolMode('node_compare')).toBe('auto')
  }
)
