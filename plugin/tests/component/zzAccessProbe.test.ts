import { it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

it('probe', async () => {
  const specs = []
  for (let i = 0; i < 4000; i++)
    specs.push({ path: `F${i % 200}/Note ${i}.md`, frontmatter: i % 3 ? { groups: ['[[Group A]]'] } : {} })
  specs.push({ path: 'Group A.md' })
  const app = useVault(specs)
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const a = AgentRegistry.getInstance().create({ name: 'X', scope: [{ type: 'group', path: 'Group A.md' }, { type: 'folder', path: 'F1' }] })
  const view = mount(AgentEditorModal, { props: { agentId: a.id }, global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } } })
  const log = (what: string, t0: number) => { console.log(what, Math.round(performance.now() - t0), 'ms', JSON.stringify(app.stats)); app.resetStats() }
  app.resetStats()
  let t = performance.now()
  await view.findAll('.abele-tabs__tab').find((x) => x.text() === 'Access')!.trigger('click')
  await flushPromises()
  log('open access', t)
  const tm = view.findComponent(ToolModesEditor)
  t = performance.now()
  await tm.vm.$emit('update', 'fetch', 'ask'); await flushPromises()
  log('one tool mode', t)
  t = performance.now()
  AgentRegistry.getInstance().update(a.id, { permissionMode: 'confirm-all' } as never); await flushPromises()
  log('permission mode', t)
  view.unmount()
})
