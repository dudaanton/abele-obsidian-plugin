import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSubAgent } from '@/ai/SubAgentRunner'
import { createAgent } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type PermissionMode, type ToolMode } from '@/ai/types'
import type { AgentTool, ModelConfig } from '@/ai/client'
import { createListWorkspaceTool } from '@/ai/tools/ListWorkspaceTool'
import { useVault } from '../helpers/testEnv'

const probe = vi.hoisted(() => ({ name: '', args: {} as Record<string, unknown>, result: '' }))
vi.mock('@/ai/client/AgentLoop', () => ({
  AgentLoop: class {
    async run(options: any) {
      const verdict = await options.beforeToolCall(probe.name, 'sample', probe.args)
      probe.result = verdict?.block ? verdict.reason : ''
      if (!verdict?.block) {
        const tool = options.tools.find((tool: AgentTool) => tool.name === probe.name)
        if (tool)
          probe.result = (await tool.execute('sample', probe.args)).content
            .map((c: { text: string }) => c.text)
            .join('')
      }
      return { messages: [{ role: 'assistant', content: [{ type: 'text', text: probe.result }] }] }
    }
  },
}))
const model = { id: 'sample', baseUrl: 'https://model.example', apiKey: '' } as ModelConfig
const agent = (permissionMode: PermissionMode, toolModes: Record<string, ToolMode> = {}) =>
  createAgent({ permissionMode, toolModes, scope: [{ type: 'folder', path: 'Project' }] })
const check = async (
  target: ReturnType<typeof agent>,
  name: string,
  args: Record<string, unknown> = {},
  tools: AgentTool[] = []
) => {
  probe.name = name
  probe.args = args
  return runSubAgent({ systemPrompt: '', userMessage: 'Sample task', tools, model }, target)
}
beforeEach(() => {
  useVault([
    { path: 'Project/Visible.md', content: 'visible' },
    { path: 'Separate/Hidden.md', content: 'hidden' },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, permissionMode: 'allow-all' }
})

describe('script-started agent approvals', () => {
  it('refuses Ask and Off but permits Auto feature tools', async () => {
    for (const name of [
      'fetch',
      'eval_js',
      'write_settings',
      'current_location',
      'remember',
      'create_script',
      'apply_template',
    ]) {
      expect(await check(agent('allow-all', { [name]: 'ask' }), name)).toMatch(/approval/)
      expect(await check(agent('allow-all', { [name]: 'off' }), name)).toMatch(/not enabled/)
      expect(await check(agent('allow-all', { [name]: 'auto' }), name)).toBe('')
    }
  })
  it('uses the target mode for every core write, rather than the global mode', async () => {
    for (const name of ['write', 'replace', 'edit', 'create', 'rm', 'mv', 'cp']) {
      expect(
        await check(agent('confirm-all'), name, {
          path: 'Project/Visible.md',
          from: 'Project/Visible.md',
        })
      ).toMatch(/permission|approval/)
    }
  })
  it('allows edits under allow-edit but requires allow-all for deletion and moves', async () => {
    expect(await check(agent('allow-edit'), 'write', { path: 'Project/Visible.md' })).toBe('')
    expect(await check(agent('allow-edit'), 'rm', { path: 'Project/Visible.md' })).toMatch(
      /permission|approval/
    )
    expect(await check(agent('allow-all'), 'rm', { path: 'Project/Visible.md' })).toBe('')
  })
  it('refuses source access outside the target scope', async () => {
    for (const name of ['read', 'write', 'replace', 'read_image']) {
      expect(await check(agent('allow-all'), name, { path: 'Separate/Hidden.md' })).toMatch(/scope/)
    }
  })
  it('passes its own scope into tools with no path', async () => {
    const result = await check(agent('confirm-all'), 'workspace', {}, [createListWorkspaceTool()])
    expect(result).toContain('Visible')
    expect(result).not.toContain('Hidden')
  })
  it('does not add the unapproved destination-write restriction', async () => {
    expect(await check(agent('allow-all'), 'create', { path: 'Separate/New.md' })).toBe('')
    expect(
      await check(agent('allow-all'), 'cp', { from: 'Project/Visible.md', to: 'Separate/Copy.md' })
    ).toBe('')
  })
})
