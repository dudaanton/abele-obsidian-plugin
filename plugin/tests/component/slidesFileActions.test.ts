import { expect, it, vi } from 'vitest'
import { EditableFileView, TFile } from 'obsidian'
import { DeckView } from '@/slides/DeckView'
import { attachNoteToChat } from '@/commands/attachChat'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

vi.mock('@/commands/attachChat', () => ({ attachNoteToChat: vi.fn(async () => true) }))

it('uses native editable file menus and initializes title editing and the shared attachment', async () => {
  expect(DeckView.prototype).toBeInstanceOf(EditableFileView)
  const open = vi.fn(async () => {})
  Object.defineProperty(EditableFileView.prototype, 'onOpen', { value: open, configurable: true })
  const file = Object.assign(new TFile(), { path: 'Slides/sample.md' })
  const actions = new Map<string, () => void>()
  const view = Object.assign(Object.create(DeckView.prototype) as DeckView, {
    file,
    viewer: {},
    addAction: (_icon: string, title: string, run: () => void) => actions.set(title, run),
  })
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true }
  try {
    await view.onOpen()
    expect(open).toHaveBeenCalledOnce()
    expect(actions.has('Attach to a chat')).toBe(true)
    actions.get('Attach to a chat')!()
    expect(attachNoteToChat).toHaveBeenCalledWith(file)
  } finally {
    delete (EditableFileView.prototype as unknown as { onOpen?: unknown }).onOpen
  }
})
