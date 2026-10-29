import { beforeEach, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { printNoteChrome } from '@/markdown/printNoteChrome'
import { PRINT_MODE } from '@/markdown/printMode'
import { usePagedList } from '@/composables/usePagedList'
import { useFooterFold } from '@/composables/useFooterFold'
import {
  useFooterLogsView,
  useFooterTasksView,
  useFooterTimeline,
} from '@/composables/useFooterView'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_SETTINGS } from '@/services/settingsShape'
import { collectEntries, buildPayload, applyEntries } from '@/transfer/entries'
import { configureAbele, useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([{ path: 'Sample.md', frontmatter: {} }])
  configureAbele()
  AbeleConfig.getInstance().headerButtons = []
  AbeleConfig.getInstance().timeTrackableNoteTypes = []
  AbeleConfig.getInstance().ai = { ...DEFAULT_SETTINGS.ai! }
  document.body.replaceChildren()
})

it('omits note chrome by default and includes it only when requested', async () => {
  expect(DEFAULT_SETTINGS.pdfIncludeHeaderFooter).toBe(false)
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  root.innerHTML = '<div class="markdown-rendered"><p>Body</p></div>'
  const el = root.firstElementChild as HTMLElement
  const children: { unload(): void }[] = []
  const ctx = {
    sourcePath: 'Sample.md',
    addChild(child: { load(): void; unload(): void }) {
      child.load()
      children.push(child)
    },
  } as unknown as MarkdownPostProcessorContext
  AbeleConfig.getInstance().pdfIncludeHeaderFooter = false
  await printNoteChrome(el, ctx)
  expect(el.querySelector('.abele-print-chrome')).toBeNull()
  const included = root.appendChild(document.createElement('div'))
  included.className = 'markdown-rendered'
  included.textContent = 'Body'
  AbeleConfig.getInstance().pdfIncludeHeaderFooter = true
  try {
    await printNoteChrome(included, ctx)
    expect(included.querySelectorAll('.abele-print-chrome')).toHaveLength(2)
    expect(included.textContent).toContain('Body')
  } finally {
    children.forEach((child) => child.unload())
  }
})

it('prints all footer rows without restoring folds or waiting for visibility', () => {
  const wrapper = mount(
    defineComponent({
      setup() {
        const pages = usePagedList(() => Array.from({ length: 125 }, (_, i) => i))
        const fold = useFooterFold('backlinks')
        expect(useFooterLogsView().initial).toBe(false)
        expect(useFooterTasksView().available).toBe(false)
        expect(useFooterTimeline().overdueOpen).toBe(true)
        return () =>
          h('div', `${pages.visible.value.length}:${pages.hasMore.value}:${fold.collapsed.value}`)
      },
    }),
    { global: { provide: { [PRINT_MODE as symbol]: true } } }
  )
  expect(wrapper.text()).toBe('125:false:false')
  wrapper.unmount()
})

it('includes task metadata as static text using configured property names', async () => {
  useVault([
    {
      path: 'Sample.md',
      frontmatter: { type: 'task', date: '2025-01-02', rank: 'high', tags: ['sample'] },
    },
  ])
  const config = AbeleConfig.getInstance()
  config.pdfIncludeHeaderFooter = true
  config.taskPriorityProperty = 'rank'
  config.taskLabelProperty = 'tags'
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const el = root.appendChild(document.createElement('div'))
  el.className = 'markdown-rendered'
  const children: { unload(): void }[] = []
  const ctx = {
    sourcePath: 'Sample.md',
    addChild(child: { load(): void; unload(): void }) {
      child.load()
      children.push(child)
    },
  } as unknown as MarkdownPostProcessorContext
  try {
    await printNoteChrome(el, ctx)
    const header = el.querySelector('.abele-print-header')!
    for (const value of ['2025-01-02', 'rank', 'high', 'tags', 'sample'])
      expect(header.textContent).toContain(value)
    expect(header.querySelector('button, input')).toBeNull()
  } finally {
    children.forEach((child) => child.unload())
    root.remove()
  }
})

it('transfers the PDF preference with other settings', () => {
  const settings = { ...DEFAULT_SETTINGS, pdfIncludeHeaderFooter: true }
  const entries = collectEntries(settings).filter((entry) => entry.section === 'other')
  const payload = buildPayload(entries, null)
  expect(applyEntries(payload.entries, { ...DEFAULT_SETTINGS }).pdfIncludeHeaderFooter).toBe(true)
})
