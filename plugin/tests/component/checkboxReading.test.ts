import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu, Notice, TFile, type MarkdownPostProcessor, type Plugin } from 'obsidian'
import { registerCheckboxes } from '@/checkboxes/register'

// Icons need Obsidian's document extensions; this tier tests menu targets and file writes.
vi.mock('@/checkboxes/presentation', () => ({ installCheckboxIcons: () => () => {} }))

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function fixture() {
  let text =
    'Sample checklist\n\n- [/] Parent\n  - [?] Nested item\n\n> Quote paragraph\n>\n> - [>] Quoted item\n'
  const original = text
  const file = new TFile()
  file.path = 'sample-checklist.md'
  let processMarkdown: MarkdownPostProcessor
  const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
  const process = vi.fn(async (_file: TFile, update: (value: string) => string) => {
    text = update(text)
  })
  const plugin = {
    app: {
      vault: { getAbstractFileByPath: () => file, process },
      workspace: { on: vi.fn() },
    },
    register: (cleanup: () => void) => cleanups.push(cleanup),
    registerEvent: vi.fn(),
    registerMarkdownPostProcessor: (callback: MarkdownPostProcessor) => {
      processMarkdown = callback
    },
    addCommand: vi.fn(),
  } as unknown as Plugin
  registerCheckboxes(plugin)

  function render() {
    const root = document.createElement('div')
    root.className = 'markdown-preview-view'
    document.body.replaceChildren(root)
    function section(
      lineStart: number,
      lineEnd: number,
      relative: number,
      label: string,
      quoted: boolean
    ) {
      const el = document.createElement('div')
      const li = document.createElement('li')
      li.dataset.task = '?'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.className = 'task-list-item-checkbox'
      input.dataset.line = String(relative)
      li.append(input, label)
      const list = document.createElement('ul')
      list.append(li)
      if (quoted) {
        const quote = document.createElement('blockquote')
        const paragraph = document.createElement('p')
        paragraph.textContent = 'Quote paragraph'
        quote.append(paragraph, list)
        el.append(quote)
      } else {
        const parentList = document.createElement('ul')
        const parent = document.createElement('li')
        parent.append('Parent', list)
        parentList.append(parent)
        el.append(parentList)
      }
      root.append(el)
      processMarkdown(el, {
        sourcePath: file.path,
        getSectionInfo: () => ({ text, lineStart, lineEnd }),
      } as Parameters<MarkdownPostProcessor>[1])
      return input
    }
    return {
      nested: section(2, 3, 1, 'Nested item', false),
      quoted: section(5, 7, 2, 'Quoted item', true),
    }
  }
  async function schedule(input: HTMLInputElement) {
    const calls = shown.mock.calls.length
    input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(shown).toHaveBeenCalledTimes(calls + 1)
    const menu = shown.mock.instances.at(-1)!
    menu.items.find((item) => item.title === 'Scheduled')!.handler!()
    // The menu callback schedules the guarded vault write in a microtask.
    await Promise.resolve()
    await Promise.resolve()
    return menu
  }
  return { render, schedule, process, original, read: () => text }
}

describe('reading-view checkbox source mapping', () => {
  it.each(['nested', 'quoted'] as const)(
    'maps the %s section-relative data-line into the full source',
    async (row) => {
      const f = fixture()
      await f.schedule(f.render()[row])
      expect(f.process).toHaveBeenCalledOnce()
      expect(f.read()).toBe(
        row === 'nested'
          ? f.original.replace('[?] Nested item', '[<] Nested item')
          : f.original.replace('[>] Quoted item', '[<] Quoted item')
      )
    }
  )

  it('maps a fresh quoted checkbox after the nested write rerenders the preview', async () => {
    const f = fixture()
    const first = f.render()
    await f.schedule(first.nested)
    const second = f.render()
    expect(first.quoted.isConnected).toBe(false)
    await f.schedule(second.quoted)
    expect(f.process).toHaveBeenCalledTimes(2)
    expect(f.read()).toBe(
      f.original
        .replace('[?] Nested item', '[<] Nested item')
        .replace('[>] Quoted item', '[<] Quoted item')
    )
  })

  it('does not reuse the detached quoted input from before a preview rerender', async () => {
    const f = fixture()
    const first = f.render()
    await f.schedule(first.nested)
    f.render()
    const shown = vi.mocked(Menu.prototype.showAtPosition)
    shown.mockClear()
    first.quoted.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(shown).not.toHaveBeenCalled()
    expect(f.process).toHaveBeenCalledOnce()
    expect(f.read()).toBe(f.original.replace('[?] Nested item', '[<] Nested item'))
  })

  it('refuses an old menu callback after its source marker has changed', async () => {
    const f = fixture()
    const menu = await f.schedule(f.render().nested)
    const notices = Notice.shown.length
    menu.items.find((item) => item.title === 'Scheduled')!.handler!()
    await vi.waitFor(() => expect(Notice.shown.length).toBe(notices + 1))
    expect(Notice.shown.at(-1)).toContain('checklist changed')
    expect(f.read()).toBe(f.original.replace('[?] Nested item', '[<] Nested item'))
  })
})
