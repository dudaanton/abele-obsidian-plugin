import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import TextCommentDialog from '@/components/TextCommentDialog.vue'
import { memoryComments } from '../helpers/textComments'

vi.mock('@/modal/confirm', () => ({ confirmAction: vi.fn(async () => true) }))
// Both shells hold the same comments: a card by the passage, or Obsidian's sheet.
const Shell = defineComponent({
  props: ['canClose', 'anchor', 'label', 'title', 'phoneSheet'],
  emits: ['close'],
  template: '<div><slot/></div>',
})
/** What each focused field held, in order: the field that took the focus. */
const focused: string[] = []
const NoteEditor = defineComponent({
  methods: {
    focus(this: { modelValue: string }) {
      focused.push(this.modelValue)
    },
  },
  props: ['modelValue'],
  emits: ['update:modelValue', 'submit', 'escape'],
  template:
    '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const Button = defineComponent({
  props: ['text', 'disabled'],
  template: '<button :disabled="disabled">{{text}}</button>',
})
// A glyph button, named by its tooltip as the real one is.
const Icon = defineComponent({
  props: ['tooltip', 'disabled'],
  emits: ['click'],
  template:
    '<button :aria-label="tooltip" :disabled="disabled" @click="$emit(\'click\', $event)" />',
})
const ANCHOR = { left: 10, top: 10, bottom: 30 }
let wrapper: VueWrapper | undefined
afterEach(() => wrapper?.unmount())
function open(props: Record<string, unknown>) {
  wrapper = mount(TextCommentDialog, {
    props: { anchor: ANCHOR, ...props } as never,
    global: {
      stubs: {
        Modal: Shell,
        ObsidianModal: Shell,
        AnchoredCard: Shell,
        NoteEditorField: NoteEditor,
        Button,
        Icon,
        Quote: { props: ['text'], template: '<blockquote>{{text}}</blockquote>' },
        Markdown: { props: ['text'], template: '<div>{{text}}</div>' },
      },
    },
  })
  return wrapper
}
/** A button by its words, or a glyph by the start of its name: Send, Edit, Delete. */
async function press(text: string) {
  await wrapper!
    .findAll('button')
    .find((button) => button.text() === text || button.attributes('aria-label')?.startsWith(text))!
    .trigger('click')
  await flushPromises()
}
/** The reply field is the last one; a comment being changed has its own above it. */
const reply = () => wrapper!.findAll('textarea').at(-1)!
const changing = () => wrapper!.find('.abele-text-comments__entry.is-editing textarea')
const selection = { note: 'Notes/sample.md', source: 'sample words', from: 0, to: 12 }

describe('comments on a passage', () => {
  it('reopens a persisted orphan and puts its mark back without new entries', async () => {
    const m = memoryComments()
    const draft = await m.service.draft(
      'Notes/sample.md',
      'sample words',
      0,
      12,
      'yellow',
      'Retained'
    )
    m.failDocument(true)
    await expect(m.service.publish(draft)).rejects.toThrow()
    const initial = (await m.repository.read(draft.thread.id))!
    m.failDocument(false)
    open({ service: m.service, initial, orphan: true, unresolved: true })
    expect(wrapper!.find('blockquote').text()).toBe('sample words')
    await press('Put the mark back')
    expect(m.notes.get('Notes/sample.md')).toBe(`sample words%%c:${initial.thread.id}%%`)
    expect(await m.repository.read(initial.thread.id)).toEqual(initial)
    expect(m.files.size).toBe(1)
  })

  it('sends, stacks replies, changes one where it stands and deletes them one by one', async () => {
    const m = memoryComments()
    open({ service: m.service, selection })
    await reply().setValue('**First**')
    await press('Send')
    const saved = await m.repository.read([...m.files.keys()][0])
    expect(saved!.thread.entries[0].body).toBe('**First**')
    expect(wrapper!.text()).toContain('First')
    expect(reply().element.value).toBe('')
    await reply().setValue('Second\nline')
    await press('Send')
    expect(
      (await m.repository.read(saved!.thread.id))!.thread.entries.map((entry) => entry.body)
    ).toEqual(['**First**', 'Second\nline'])
    await press('Edit')
    expect(changing().element.value).toBe('**First**')
    await changing().setValue('Changed')
    await press('Save')
    const edited = (await m.repository.read(saved!.thread.id))!
    expect(edited.thread.entries[0]).toMatchObject({ body: 'Changed' })
    expect(edited.thread.entries[0].editedAt).toBeDefined()
    expect(changing().exists()).toBe(false)
    await press('Delete')
    expect(
      (await m.repository.read(saved!.thread.id))!.thread.entries.map((entry) => entry.body)
    ).toEqual(['Second\nline'])
    await press('Delete')
    expect(m.files.size).toBe(0)
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('leaves a comment as it was when changing it is cancelled', async () => {
    const m = memoryComments()
    const initial = await m.service.publish(
      await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'Saved')
    )
    open({ service: m.service, initial })
    await press('Edit')
    await changing().setValue('Not this')
    await press('Cancel')
    expect(changing().exists()).toBe(false)
    expect((await m.repository.read(initial.thread.id))!.thread.entries[0].body).toBe('Saved')
  })

  it('focuses the field for the change within the press on Edit, never the reply field first', async () => {
    const m = memoryComments()
    const initial = await m.service.publish(
      await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'Saved')
    )
    open({ service: m.service, initial })
    focused.length = 0
    const edit = wrapper!
      .findAll('button')
      .find((button) => button.attributes('aria-label')?.startsWith('Edit'))!
    // A phone shows its keyboard only for a focus taken while the tap is handled: the field is
    // drawn and focused in the microtasks of that same task, before any timer. Focus passed on
    // from the reply field instead raised the keyboard and then lost it with the first keys.
    ;(edit.element as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    expect(focused).toEqual(['Saved'])
    await flushPromises()
    expect(changing().element.value).toBe('Saved')
    expect(focused).toEqual(['Saved'])
  })

  it('keeps text typed during a slow send as a change to that comment, never a repeat', async () => {
    const m = memoryComments()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const write = m.repository.write.bind(m.repository)
    vi.spyOn(m.repository, 'write').mockImplementation(async (thread, expected) => {
      await gate
      return write(thread, expected)
    })
    open({ service: m.service, selection })
    await reply().setValue('First version')
    await press('Send')
    await reply().setValue('Continued version')
    release()
    await flushPromises()
    expect((await m.repository.read([...m.files.keys()][0]))!.thread.entries[0].body).toBe(
      'First version'
    )
    expect(reply().element.value).toBe('Continued version')
    expect(wrapper!.text()).toContain('Goes into your last comment')
    await press('Send')
    const saved = (await m.repository.read([...m.files.keys()][0]))!
    expect(saved.thread.entries).toHaveLength(1)
    expect(saved.thread.entries[0].body).toBe('Continued version')
  })

  it('keeps typing that was going on while the last comment was deleted', async () => {
    const m = memoryComments()
    const initial = await m.service.publish(
      await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'Saved')
    )
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    open({ service: m.service, initial, beforeWrite: () => gate })
    const deleting = press('Delete')
    await reply().setValue('Typed during deletion')
    release()
    await deleting
    await flushPromises()
    expect(m.files.size).toBe(0)
    expect(reply().element.value).toBe('Typed during deletion')
    expect(wrapper!.emitted('close')).toBeUndefined()
    expect(wrapper!.find('[role="alert"]').text()).toContain('thread was deleted')
  })

  it('closes at once and keeps an unsent reply for the next opening', async () => {
    const m = memoryComments()
    open({ service: m.service, selection })
    await reply().setValue('Half a thought')
    const canClose = wrapper!.findComponent(Shell).props('canClose') as () => Promise<boolean>
    expect(await canClose()).toBe(true)
    wrapper!.unmount()
    expect(m.files.size).toBe(0)
    open({ service: m.service, selection })
    expect(reply().element.value).toBe('Half a thought')
    await reply().setValue('')
  })

  it('keeps a failed send in the field, retries without repeats, and changes the mark at once', async () => {
    const m = memoryComments()
    open({ service: m.service, selection })
    await reply().setValue('Draft')
    m.failDocument(true)
    await press('Send')
    expect(wrapper!.find('[role="alert"]').text()).toContain('document failed')
    expect(reply().element.value).toBe('Draft')
    expect(m.files.size).toBe(1)
    m.failDocument(false)
    await press('Send')
    expect(m.files.size).toBe(1)
    await press('Marked yellow')
    await press('underlined')
    const saved = (await m.repository.read([...m.files.keys()][0]))!
    expect(saved.thread.appearance).toBe('underline')
    expect(saved.thread.entries).toHaveLength(1)
  })

  it('opens as a sheet with the passage shown when there is no place to stand by', () => {
    const m = memoryComments()
    open({ service: m.service, selection, anchor: undefined })
    expect(wrapper!.findComponent(Shell).props('title')).toBe('Comments')
    expect(wrapper!.find('blockquote').text()).toBe('sample words')
  })
})
