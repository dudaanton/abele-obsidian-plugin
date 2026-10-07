import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import TextCommentDialog from '@/components/TextCommentDialog.vue'
import { memoryComments } from '../helpers/textComments'

vi.mock('@/modal/confirm', () => ({ confirmAction: vi.fn(async () => true) }))
const Modal = defineComponent({
  props: ['canClose'],
  emits: ['close'],
  template: '<div><slot/><slot name="footer"/></div>',
})
const NoteEditor = defineComponent({
  methods: { focus() {} },
  props: ['modelValue'],
  emits: ['update:modelValue', 'submit'],
  template:
    '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const Button = defineComponent({
  props: ['text', 'disabled'],
  template: '<button :disabled="disabled">{{text}}</button>',
})
let wrapper: VueWrapper | undefined
afterEach(() => wrapper?.unmount())
function open(props: Record<string, unknown>) {
  wrapper = mount(TextCommentDialog, {
    props: props as never,
    global: {
      stubs: {
        ObsidianModal: Modal,
        NoteEditorField: NoteEditor,
        Button,
        Markdown: { props: ['text'], template: '<div>{{text}}</div>' },
      },
    },
  })
  return wrapper
}
async function press(text: string) {
  await wrapper!
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
  await flushPromises()
}

describe('free-form comment dialog', () => {
  it('reopens a persisted orphan and republishes its existing marker without new entries', async () => {
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
    expect(wrapper!.findAll('button').some((button) => button.text() === 'Republish marker')).toBe(
      true
    )
    await press('Republish marker')
    expect(m.notes.get('Notes/sample.md')).toBe(`sample words%%c:${initial.thread.id}%%`)
    expect(await m.repository.read(initial.thread.id)).toEqual(initial)
    expect(m.files.size).toBe(1)
  })
  it.each([false, true])(
    'retains typing while deleting an entry (siblings: %s)',
    async (siblings) => {
      const m = memoryComments()
      let initial = await m.service.publish(
        await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'Saved')
      )
      if (siblings) initial = await m.service.add(initial, 'Sibling')
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      open({ service: m.service, initial, beforeWrite: () => gate })
      if (siblings) await press('Edit')
      await press('Delete')
      await wrapper!.find('textarea').setValue('Typed during deletion')
      release()
      await flushPromises()
      expect(wrapper!.find('textarea').element.value).toBe('Typed during deletion')
      expect(wrapper!.emitted('close')).toBeUndefined()
      if (siblings) {
        expect(
          (await m.repository.read(initial.thread.id))!.thread.entries.map((entry) => entry.body)
        ).toEqual(['Sibling'])
        await press('Save')
        expect(
          (await m.repository.read(initial.thread.id))!.thread.entries.map((entry) => entry.body)
        ).toEqual(['Sibling', 'Typed during deletion'])
      }
    }
  )
  it('keeps text typed during a slow save as an edit draft instead of silently clearing it', async () => {
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
    open({
      service: m.service,
      selection: { note: 'Notes/sample.md', source: 'sample words', from: 0, to: 12 },
    })
    await wrapper!.find('textarea').setValue('First version')
    await press('Save')
    await wrapper!.find('textarea').setValue('Continued version')
    release()
    await flushPromises()
    expect((await m.repository.read([...m.files.keys()][0]))!.thread.entries[0].body).toBe(
      'First version'
    )
    expect(wrapper!.find('textarea').element.value).toBe('Continued version')
    await press('Save')
    const saved = (await m.repository.read([...m.files.keys()][0]))!
    expect(saved.thread.entries).toHaveLength(1)
    expect(saved.thread.entries[0].body).toBe('Continued version')
  })
  it('does not discard an unsaved add-entry draft when deleting the final saved entry', async () => {
    const m = memoryComments()
    const initial = await m.service.publish(
      await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'Saved')
    )
    const { confirmAction } = await import('@/modal/confirm')
    open({ service: m.service, initial })
    await wrapper!.find('textarea').setValue('Unsaved next entry')
    vi.mocked(confirmAction).mockImplementation(
      async (_app, options) => options.title !== 'Discard unsaved comment?'
    )
    await press('Delete')
    expect(m.files.size).toBe(1)
    expect(wrapper!.find('textarea').element.value).toBe('Unsaved next entry')
    expect(wrapper!.emitted('close')).toBeUndefined()
    vi.mocked(confirmAction).mockResolvedValue(true)
  })
  it('saves without AI, reopens and stacks, edits and confirms individual deletion', async () => {
    const m = memoryComments()
    open({
      service: m.service,
      selection: { note: 'Notes/sample.md', source: 'sample words', from: 0, to: 12 },
    })
    await wrapper!.find('textarea').setValue('**First**')
    await press('Save')
    const saved = await m.repository.read([...m.files.keys()][0])
    expect(saved!.thread.entries[0].body).toBe('**First**')
    expect(wrapper!.text()).toContain('First')
    await wrapper!.find('textarea').setValue('Second\nline')
    await press('Save')
    expect(
      (await m.repository.read(saved!.thread.id))!.thread.entries.map((entry) => entry.body)
    ).toEqual(['**First**', 'Second\nline'])
    await press('Edit')
    await wrapper!.find('textarea').setValue('Changed')
    await press('Save')
    expect((await m.repository.read(saved!.thread.id))!.thread.entries[0].editedAt).toBeDefined()
    await press('Delete')
    expect(
      (await m.repository.read(saved!.thread.id))!.thread.entries.map((entry) => entry.body)
    ).toEqual(['Second\nline'])
    await press('Delete')
    expect(m.files.size).toBe(0)
  })
  it('cancels without creating files and requires consent to discard dirty text', async () => {
    const m = memoryComments()
    const { confirmAction } = await import('@/modal/confirm')
    open({
      service: m.service,
      selection: { note: 'Notes/sample.md', source: 'sample words', from: 0, to: 12 },
    })
    await press('Close')
    expect(m.files.size).toBe(0)
    await wrapper!.find('textarea').setValue('Draft')
    vi.mocked(confirmAction).mockResolvedValueOnce(false)
    const canClose = wrapper!.findComponent(Modal).props('canClose') as () => Promise<boolean>
    expect(await canClose()).toBe(false)
    expect(wrapper!.find('textarea').element.value).toBe('Draft')
    expect(m.files.size).toBe(0)
  })
  it('retains a failed-save draft, retries without duplicates, and saves appearance independently', async () => {
    const m = memoryComments()
    open({
      service: m.service,
      selection: { note: 'Notes/sample.md', source: 'sample words', from: 0, to: 12 },
    })
    await wrapper!.find('textarea').setValue('Draft')
    m.failDocument(true)
    await press('Save')
    expect(wrapper!.find('[role="alert"]').text()).toContain('document failed')
    expect(wrapper!.find('textarea').element.value).toBe('Draft')
    expect(m.files.size).toBe(1)
    m.failDocument(false)
    await press('Save')
    expect(m.files.size).toBe(1)
    await wrapper!.find('select').setValue('underline')
    await press('Save')
    expect((await m.repository.read([...m.files.keys()][0]))!.thread.appearance).toBe('underline')
    expect((await m.repository.read([...m.files.keys()][0]))!.thread.entries).toHaveLength(1)
  })
})
