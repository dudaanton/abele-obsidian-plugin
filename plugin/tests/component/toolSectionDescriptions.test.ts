/**
 * What a section tells the agent before it is opened is the person's to change, like any tool's
 * words: the section's entry heads its group in the tool descriptions screen.
 */
import { beforeEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolDescriptions from '@/components/settings/ai/ToolDescriptions.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { codeToolDescriptions, getSectionToolRegistry } from '@/ai/tools'
import { pruneToolDescriptions } from '@/ai/tools/toolDescriptionOverrides'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})

it('lists each section first in its own group, with no mode of its own', async () => {
  const view = mount(ToolDescriptions, { props: { descriptions: {} } })
  const group = () =>
    view.findAllComponents(TreeItem).find((item) => item.props('text') === 'Canvas')!
  group().vm.$emit('click')
  await view.vm.$nextTick()
  const rows = group()
    .findAllComponents(TreeItem)
    .map((item) => item.props('text'))
    .filter((text) => text !== 'Canvas')
  expect(rows[0]).toBe('Open Canvas')
  expect(rows).toContain('Read canvas')
  expect(getSectionToolRegistry().every((t) => !('permissionKey' in t) || !t.permissionKey)).toBe(
    true
  )
  view.unmount()
})

it("keeps the person's words for a section and drops a saved copy of its default", () => {
  const current = codeToolDescriptions()
  expect(current.open_canvas).toContain('canvases')
  const { kept } = pruneToolDescriptions(
    { open_canvas: current.open_canvas, open_maps: 'Sample words for maps.' },
    current
  )
  expect(kept).toEqual({ open_maps: 'Sample words for maps.' })
})
