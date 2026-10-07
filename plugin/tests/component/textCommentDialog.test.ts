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
