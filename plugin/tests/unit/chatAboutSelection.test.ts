/**
 * "Chat about this" with something selected in the note.
 *
 * The owner's words: when a note has a selection, it goes straight into the chat, as it does with
 * "Use in AI agent". So the input holds a link to the selected lines and the passage quoted the
 * way "Use in AI agent" quotes it — and only the note's own selection counts, never one left in
 * another note.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MarkdownView, Menu, TFile, type Editor, type Plugin } from 'obsidian'
import { chatAboutText, registerChatAbout, viewSelection } from '@/commands/chatAboutNote'
import { useInAgentText } from '@/ai/quoteSelection'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE = 'Projects/Budget.md'
const OTHER = 'Journal/2026-09-24.md'
const LINES = ['# Budget', 'Rent 900', 'Food 300', 'Fun 100']

let app: FakeApp
let service: ChatService

const fileAt = (path: string) => app.vault.getAbstractFileByPath(path) as TFile

/** An editor with lines `from`–`to` (0-based, the editor's own count) selected, or nothing. */
function fakeEditor(sel?: { from: number; to: number; endCh?: number }): Editor {
  const text = sel ? LINES.slice(sel.from, sel.to + 1).join('\n') : ''
  return {
    getSelection: () => text,
    getCursor: (which?: string) =>
      !sel
        ? { line: 0, ch: 0 }
        : which === 'from'
          ? { line: sel.from, ch: 0 }
          : { line: sel.to, ch: sel.endCh ?? LINES[sel.to].length },
  } as unknown as Editor
}

/** A note's pane, in the editor or in reading view. */
function fakePane(path: string, mode: 'source' | 'preview', editor = fakeEditor()): MarkdownView {
  const containerEl = document.createElement('div')
  document.body.appendChild(containerEl)
  return Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    file: fileAt(path),
    editor,
    getMode: () => mode,
    previewMode: { containerEl },
    contentEl: containerEl,
  })
}

function paragraph(parent: HTMLElement, text: string): HTMLElement {
  const p = document.createElement('p')
  p.textContent = text
  parent.appendChild(p)
  return p
}

/** Selects the text of an element on the page, as a drag in reading view would. */
function selectOnPage(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

type Handler = (...args: unknown[]) => void
const handlers = new Map<string, Handler>()
const commands: Array<{ id: string; checkCallback: (c: boolean) => boolean }> = []
let activeView: MarkdownView | null = null

function fakePlugin(): Plugin {
  handlers.clear()
  commands.length = 0
  return {
    app: {
      workspace: {
        on: (name: string, fn: Handler) => {
          handlers.set(name, fn)
          return { name }
        },
        getActiveFile: () => activeView?.file ?? null,
        getActiveViewOfType: () => activeView,
        getMostRecentLeaf: () => null,
      },
    },
    registerEvent: () => {},
    addCommand: (c: (typeof commands)[number]) => commands.push(c),
  } as unknown as Plugin
}

beforeEach(() => {
  app = useVault([
    { path: NOTE, content: LINES.join('\n') },
    { path: OTHER, content: 'A day' },
  ])
  // Obsidian's link generator, by the vault's link settings: here, shortest wikilinks.
  ;(app.fileManager as unknown as Record<string, unknown>).generateMarkdownLink = (
    f: TFile,
    _source: string,
    subpath = '',
    alias?: string
  ) => `[[${f.basename}${subpath}${alias ? `|${alias}` : ''}]]`

  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  ;(ChatService as unknown as { instance: ChatService | null }).instance = null
  service = ChatService.getInstance()
  vi.spyOn(service, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue(undefined)
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'm', scope: [] })
  registry.update(agent.id, { fullVaultAccess: true })
  registry.setDefault(agent.id)

  activeView = null
  registerChatAbout(fakePlugin())
})

afterEach(() => {
  vi.restoreAllMocks()
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

/** The passage exactly as "Use in AI agent" quotes it, without its "From" line. */
const quoted = (text: string) => useInAgentText(text).replace(/^> From .*\n/, '')

const opened = () => vi.waitFor(() => expect(service.pendingInput.value).not.toBeNull())

describe('the text in the input', () => {
  it('is only the link when nothing is selected', () => {
    expect(chatAboutText(fileAt(NOTE))).toBe('[[Budget]] ')
    expect(chatAboutText(fileAt(NOTE), { text: '  \n' })).toBe('[[Budget]] ')
  })

  it('links to the selected lines and quotes them as "Use in AI agent" does', () => {
    const text = chatAboutText(fileAt(NOTE), {
      text: 'Rent 900\nFood 300',
      lines: { from: 2, to: 3 },
    })

    expect(text).toBe('[[Budget#L2-L3|Budget]]\n> Rent 900\n> Food 300\n\n')
    expect(text).toBe(`[[Budget#L2-L3|Budget]]\n${quoted('Rent 900\nFood 300')}`)
  })

  it('names a single line as one', () => {
    expect(chatAboutText(fileAt(NOTE), { text: 'Food', lines: { from: 3, to: 3 } })).toBe(
      '[[Budget#L3|Budget]]\n> Food\n\n'
    )
  })
})

describe('from the editor’s menu', () => {
  it('takes that editor’s selection, with its lines', async () => {
    const menu = new Menu()
    handlers.get('editor-menu')!(menu, fakeEditor({ from: 1, to: 2 }), { file: fileAt(NOTE) })

    menu.items[0].handler!()
    await opened()
    expect(service.pendingInput.value!.text).toBe(
      '[[Budget#L2-L3|Budget]]\n> Rent 900\n> Food 300\n\n'
    )
    expect(service.pendingInput.value!.focus).toBe(true)
    expect(service.activeSession.value!.allMessages.value).toEqual([])
  })

  it('does not count a line the selection only reaches the start of', async () => {
    const menu = new Menu()
    const editor = fakeEditor({ from: 1, to: 2, endCh: 0 })
    ;(editor as unknown as { getSelection: () => string }).getSelection = () => 'Rent 900\n'
    handlers.get('editor-menu')!(menu, editor, { file: fileAt(NOTE) })

    menu.items[0].handler!()
    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget#L2|Budget]]\n> Rent 900\n\n')
  })

  it('is only the link with nothing selected', async () => {
    const menu = new Menu()
    handlers.get('editor-menu')!(menu, fakeEditor(), { file: fileAt(NOTE) })

    menu.items[0].handler!()
    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget]] ')
  })
})

describe('from the command and the file menu', () => {
  it('the command takes the selection of the note in front', async () => {
    activeView = fakePane(NOTE, 'source', fakeEditor({ from: 3, to: 3 }))
    commands[0].checkCallback(false)

    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget#L4|Budget]]\n> Fun 100\n\n')
  })

  it('the file menu of the note in front takes its selection', async () => {
    activeView = fakePane(NOTE, 'source', fakeEditor({ from: 1, to: 1 }))
    const menu = new Menu()
    handlers.get('file-menu')!(menu, fileAt(NOTE), 'file-explorer-context-menu')

    menu.items[0].handler!()
    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget#L2|Budget]]\n> Rent 900\n\n')
  })

  it('a tab header takes the selection of that tab’s note', async () => {
    activeView = fakePane(OTHER, 'source', fakeEditor({ from: 0, to: 0 }))
    const leaf = { view: fakePane(NOTE, 'source', fakeEditor({ from: 2, to: 2 })) }
    const menu = new Menu()
    handlers.get('file-menu')!(menu, fileAt(NOTE), 'tab-header', leaf)

    menu.items[0].handler!()
    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget#L3|Budget]]\n> Food 300\n\n')
  })

  it('ignores a selection left in another note', async () => {
    activeView = fakePane(OTHER, 'source', fakeEditor({ from: 1, to: 2 }))
    const menu = new Menu()
    handlers.get('file-menu')!(menu, fileAt(NOTE), 'file-explorer-context-menu')

    menu.items[0].handler!()
    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget]] ')
  })
})

describe('in reading view', () => {
  it('quotes the text selected on the page, under a link to the note', async () => {
    activeView = fakePane(NOTE, 'preview')
    const p = paragraph(activeView.previewMode.containerEl, 'Rent 900')
    selectOnPage(p)

    commands[0].checkCallback(false)
    await opened()
    expect(service.pendingInput.value!.text).toBe('[[Budget]]\n> Rent 900\n\n')
  })

  it('does not take a selection somewhere else on the page', () => {
    const view = fakePane(NOTE, 'preview')
    const elsewhere = paragraph(document.body, 'A chat message')
    selectOnPage(elsewhere)

    expect(viewSelection(view)).toBeNull()
  })

  it('is only the link when nothing is selected', () => {
    expect(viewSelection(fakePane(NOTE, 'preview'))).toBeNull()
  })
})
