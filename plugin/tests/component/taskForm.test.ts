/**
 * The task dialog.
 *
 * The add and edit buttons open it instead of the note. It writes a new task the way the old
 * button did, rewrites only what it shows in an existing one, and goes to the note on request.
 * Where Obsidian's note editor cannot be borrowed, the buttons do what they did before it
 * existed. Obsidian's editor itself is not here — the e2e tier drives the real one; this
 * replaces it with a stand-in that reports text the way it does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const editorState = vi.hoisted(() => ({
  available: true,
  onChange: null as null | ((value: string) => void),
  onSubmit: null as null | (() => void),
  value: '',
}))

vi.mock('@/editor/embeddedEditor', () => ({
  isEmbeddedEditorAvailable: () => editorState.available,
  createEmbeddedEditor: (
    _app: unknown,
    host: HTMLElement,
    options: { value: string; onChange: (v: string) => void; onSubmit: () => void }
  ) => {
    if (!editorState.available) return null
    editorState.value = options.value
    editorState.onChange = (v: string) => {
      editorState.value = v
      options.onChange(v)
    }
    editorState.onSubmit = options.onSubmit
    host.classList.add('fake-note-editor')
    return {
      get: () => editorState.value,
      set: (v: string) => void (editorState.value = v),
      focus: () => {},
      contentEl: host,
      destroy: () => {},
    }
  },
}))

import { openTaskForm } from '@/commands/taskForm'

let app: FakeApp & { workspace: { openLinkText: ReturnType<typeof vi.fn> } }

const read = (path: string) => {
  const file = app.vault.getFileByPath(path)
  return file ? app.vault.read(file) : Promise.resolve(null)
}

const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find(
    (b) => b.textContent?.trim() === text
  )

const titleField = () => document.querySelector<HTMLInputElement>('.modal .abele-entry-form__title')

const type = (el: HTMLInputElement, value: string) => {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  editorState.available = true
  app = useVault([
    {
      path: 'Tasks/Call Anna.md',
      frontmatter: {
        type: 'task',
        labels: ['home'],
        date: '2026-01-01',
        dateTime: '10:00',
        recurrence: 'every week',
      },
      content: 'Call Anna\nAbout the trip\n',
    },
  ]) as typeof app
  ;(app as unknown as Record<string, unknown>).workspace = {
    getActiveViewOfType: () => null,
    openLinkText: vi.fn(),
  }
  configureAbele().tasksFolder = 'Tasks'
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('a new task', () => {
  it('is written from the form, with its date, and the dialog closes', async () => {
    await openTaskForm({ defaults: { date: '2026-09-26' } })
    await flushPromises()

    expect(document.querySelector('.modal .fake-note-editor')).not.toBeNull()
    type(titleField()!, 'Buy milk')
    editorState.onChange!('Two litres of [[Oat milk]]')
    await flushPromises()
    button('Save')!.click()
    await flushPromises()

    const raw = await read('Tasks/Buy milk.md')
    expect(raw).toContain('type: task')
    expect(raw).toMatch(/\ndate: '?2026-09-26'?\n/)
    expect(raw).toMatch(/---\nBuy milk\nTwo litres of \[\[Oat milk\]\]\n$/)
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('saves on Ctrl/Cmd+Enter from the editor', async () => {
    await openTaskForm()
    await flushPromises()
    type(titleField()!, 'Quick one')
    editorState.onSubmit!()
    await flushPromises()

    expect(await read('Tasks/Quick one.md')).toContain('Quick one')
  })

  it('opens the note it saved on "Open as note"', async () => {
    await openTaskForm()
    await flushPromises()
    type(titleField()!, 'Look closer')
    button('Open as note')!.click()
    await flushPromises()

    expect(await read('Tasks/Look closer.md')).toContain('Look closer')
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('Tasks/Look closer.md', '', false)
  })

  it('writes nothing on Cancel', async () => {
    await openTaskForm()
    await flushPromises()
    type(titleField()!, 'Never mind')
    button('Cancel')!.click()
    await flushPromises()

    expect(await read('Tasks/Never mind.md')).toBeNull()
    expect(document.querySelector('.modal')).toBeNull()
  })
})

describe('an existing task', () => {
  it('opens with what the note holds', async () => {
    await openTaskForm({ path: 'Tasks/Call Anna.md' })
    await flushPromises()

    expect(titleField()!.value).toBe('Call Anna')
    expect(editorState.value).toBe('About the trip')
    const text = document.querySelector('.modal')!.textContent
    expect(text).toContain('01.01.2026 10:00')
    expect(text).toContain('every week')
  })

  it('rewrites what the form shows and leaves every other property alone', async () => {
    await openTaskForm({ path: 'Tasks/Call Anna.md' })
    await flushPromises()

    type(titleField()!, 'Call Anna back')
    editorState.onChange!('About the trip, and the tickets')
    const removeDate = document.querySelector<HTMLElement>('.modal .abele-entry-form__clear')
    removeDate!.click()
    await flushPromises()
    button('Save')!.click()
    await flushPromises()

    const raw = (await read('Tasks/Call Anna.md'))!
    expect(raw).toContain('labels:')
    expect(raw).toContain('- home')
    expect(raw).toContain('recurrence: every week')
    expect(raw).not.toMatch(/^date:/m)
    expect(raw).not.toContain('dateTime')
    expect(raw).toMatch(/---\nCall Anna back\nAbout the trip, and the tickets\n$/)
  })
})

describe('without Obsidian’s editor to borrow', () => {
  beforeEach(() => {
    editorState.available = false
  })

  it('creates the note and opens it, as the button always did', async () => {
    await openTaskForm({ defaults: { due: '2026-10-01' } })
    await flushPromises()

    expect(document.querySelector('.modal')).toBeNull()
    const raw = await read('Tasks/New Task.md')
    expect(raw).toMatch(/\ndue: '?2026-10-01'?\n/)
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('Tasks/New Task.md', '', false)
  })

  it('opens an existing task as its note', async () => {
    await openTaskForm({ path: 'Tasks/Call Anna.md' })
    await flushPromises()

    expect(document.querySelector('.modal')).toBeNull()
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('Tasks/Call Anna.md', '', false)
  })
})
