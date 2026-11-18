import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import AbeleSections from '@/components/settings/sync/AbeleSections.vue'
import ChoiceModal from '@/components/obsidian/ChoiceModal.vue'
import VaultCheckBlock from '@/components/sync/VaultCheckBlock.vue'
import Button from '@/components/obsidian/Button.vue'
import type { AbeleSectionsSource } from '@/sync/abeleSections'
import type { VaultCheckSource, VaultCheckState } from '@/sync/vaultCheck'

function sections(): AbeleSectionsSource {
  return {
    rows: shallowRef([
      { id: 'reader', label: 'Book reader', keys: 0, missing: 0 },
      { id: 'ai-providers', label: 'AI providers', keys: 2, missing: 1 },
    ]),
    chosen: shallowRef(new Set(['ai-providers'] as const)),
    keys: shallowRef('off'),
    kept: shallowRef([]),
    differs: vi.fn(async () => true),
    choose: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    openKeys: vi.fn(),
  }
}
it('leaves plugin-disabled choices inert and shows the single key-store warning', async () => {
  const source = sections()
  const view = mount(AbeleSections, { props: { source, pluginSettings: false } })
  expect(view.findAll('input').every((input) => input.attributes('disabled') !== undefined)).toBe(
    true
  )
  expect(view.find('[data-keys-line]').exists()).toBe(false)
  await view.setProps({ pluginSettings: true })
  expect(view.get('[data-keys-line]').text()).toContain('Keys stay on each device')
  source.keys.value = 'locked'
  await flushPromises()
  expect(view.get('[data-keys-line]').text()).toContain('Synced keys are locked')
  view.unmount()
})
it('asks which differing version to take in a native phone sheet before enabling', async () => {
  const source = sections()
  const view = mount(AbeleSections, {
    props: { source, pluginSettings: true },
    global: { stubs: { ChoiceModal: true } },
  })
  ;(view.vm as unknown as { fold(title: string): void }).fold('Notes')
  await flushPromises()
  await view.get('[data-section=reader] input').trigger('change')
  await flushPromises()
  expect(source.choose).not.toHaveBeenCalled()
  const choice = view.getComponent(ChoiceModal)
  expect(choice.props('phoneSheet')).toBe(true)
  choice.vm.$emit('answer', 'vault')
  await flushPromises()
  expect(source.choose).toHaveBeenCalledWith('reader', true, 'vault')
  view.unmount()
})
it('folds a single group with more than twenty differences', async () => {
  const state = shallowRef<VaultCheckState>({
    kind: 'differs',
    total: 21,
    bytes: 21,
    at: Date.now(),
    items: Array.from({ length: 21 }, (_, i) => ({
      path: `sample-${i}.md`,
      reason: 'differs' as const,
    })),
  })
  const source: VaultCheckSource = {
    state,
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(async () => {}),
  }
  const view = mount(VaultCheckBlock, { props: { source } })
  expect(view.findAll('[data-path]')).toHaveLength(0)
  await view.get('.abele-fold-heading').trigger('click')
  expect(view.findAll('[data-path]')).toHaveLength(21)
  view.unmount()
})
it('describes a retained re-enable alternative without claiming both devices changed it', async () => {
  const source = sections()
  source.kept.value = [{ id: 'reader', from: 'Sample computer', at: Date.now(), choice: true }]
  const view = mount(AbeleSections, { props: { source, pluginSettings: true } })
  expect(view.get('[data-kept=reader]').text()).toContain('The other one stays on this device')
  expect(view.get('[data-kept=reader]').text()).not.toContain('Changed on both')
  await view.get('[data-kept=reader] button').trigger('click')
  await flushPromises()
  expect(source.restore).toHaveBeenCalledWith('reader')
  view.unmount()
})
it.each(['never', 'running', 'matched', 'stopped', 'unreachable'] as const)(
  'renders the %s check state with its action',
  async (kind) => {
    const state = shallowRef<VaultCheckState>({
      kind,
      total: 12,
      done: 5,
      bytes: 20,
      bytesDone: 10,
      bytesTotal: 20,
      at: Date.now(),
    } as VaultCheckState)
    const source = { state, start: vi.fn(), stop: vi.fn(), send: vi.fn(async () => {}) }
    const view = mount(VaultCheckBlock, { props: { source } })
    expect(view.get('[role=status]').text()).not.toContain('sync.check.')
    view.getComponent(Button).vm.$emit('click')
    expect(kind === 'running' ? source.stop : source.start).toHaveBeenCalledOnce()
    view.unmount()
  }
)
