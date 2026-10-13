import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, TFile } from 'obsidian'
import AiChatMessage from '@/components/AiChatMessage.vue'
import GalleryViewer from '@/components/GalleryViewer.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const mounted: Array<{ unmount(): void }> = []

beforeEach(() => {
  const app = useVault([{ path: 'Attachments/sample-picture.png', content: 'picture' }])
  ;(app.vault as unknown as { getResourcePath(file: TFile): string }).getResourcePath = (file) =>
    `app://sample/${file.path}`
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

function render(message: Partial<ChatMessage>, resourceOpener?: (path: string) => void) {
  const wrapper = mount(AiChatMessage, {
    props: {
      message: { id: 'sample-message', role: 'tool-call', content: '', timestamp: 1, ...message },
      resourceOpener,
    },
  })
  mounted.push(wrapper)
  return wrapper
}

it('keeps the image menu choices in their existing order and opens the preview', async () => {
  const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
  const wrapper = render({
    toolName: 'read_image',
    toolStatus: 'approved',
    toolParams: { path: 'Attachments/sample-picture.png' },
    toolResult: 'Sample image read',
  })
  await wrapper.get('.abele-chat-msg__image-preview').trigger('contextmenu')
  const menu = shown.mock.contexts.at(-1) as Menu
  expect(menu.items.map((item) => item.title)).toEqual([
    'Draw on it',
    'Preview',
    'Open file',
    'Copy path',
  ])
  menu.items.find((item) => item.title === 'Preview')!.handler!()
  await wrapper.vm.$nextTick()
  expect(wrapper.findComponent(GalleryViewer).props('images')).toEqual([
    {
      url: 'app://sample/Attachments/sample-picture.png?0-7',
      alt: 'sample-picture.png',
      type: 'local',
      path: 'Attachments/sample-picture.png',
    },
  ])
})

it('does not use vault image previews when the history supplies its own resource opener', () => {
  const wrapper = render(
    {
      toolName: 'read_image',
      toolStatus: 'approved',
      toolParams: { path: 'Attachments/sample-picture.png' },
      toolResult: 'Sample image read',
    },
    vi.fn()
  )
  expect(wrapper.find('.abele-chat-msg__image-preview').exists()).toBe(false)
})

it.each(['mv', 'cp'])('opens the destination rather than the source of %s', async (toolName) => {
  const opener = vi.fn()
  const wrapper = render(
    { toolName, toolParams: { path: 'Sample/source.md', to: 'Sample/destination.md' } },
    opener
  )
  await wrapper.get('.abele-chat-msg__tool-summary').trigger('click')
  expect(opener).toHaveBeenCalledExactlyOnceWith('Sample/destination.md')
})

it('opens a remote image from rendered reply content without granting it a vault path', async () => {
  const wrapper = render({ role: 'assistant', content: 'Sample reply' })
  const image = document.createElement('img')
  image.src = 'https://sample.invalid/picture.png'
  image.alt = 'Sample picture'
  wrapper.get('.abele-markdown').element.append(image)
  image.click()
  await wrapper.vm.$nextTick()
  expect(wrapper.findComponent(GalleryViewer).props('images')).toEqual([
    {
      url: 'https://sample.invalid/picture.png',
      alt: 'Sample picture',
      type: 'remote',
      path: 'https://sample.invalid/picture.png',
    },
  ])
})

// Another agent's or a server's file tools go by their own names and put the path under their
// own key; a verb in the name says a file is behind it.
it.each([
  ['edit_note', { note_path: 'Sample/edited.md' }, 'Sample/edited.md'],
  ['write_file', { file_path: 'Sample/written.md' }, 'Sample/written.md'],
  ['notes-append', { notePath: 'Sample/appended.md' }, 'Sample/appended.md'],
  ['Read', { filePath: 'Sample/read.md' }, 'Sample/read.md'],
  ['server_create_page', { path: 'Sample/created.md' }, 'Sample/created.md'],
])('opens the file an unknown %s tool worked on', async (toolName, toolParams, path) => {
  const opener = vi.fn()
  const wrapper = render({ toolName, toolParams }, opener)
  const summary = wrapper.get('.abele-chat-msg__tool-summary')
  expect(summary.classes()).toContain('abele-chat-msg__tool-link')
  expect(summary.attributes('role')).toBe('link')
  expect(summary.attributes('tabindex')).toBe('0')
  await summary.trigger('click')
  expect(opener).toHaveBeenCalledExactlyOnceWith(path)
  opener.mockClear()
  await summary.trigger('keydown.enter')
  expect(opener).toHaveBeenCalledExactlyOnceWith(path)
})

it.each(['editorial_summary', 'run_command'])(
  'leaves a %s tool without a file verb unopenable, whatever its params say',
  async (toolName) => {
    const opener = vi.fn()
    const wrapper = render({ toolName, toolParams: { path: 'Sample/elsewhere.md' } }, opener)
    const summary = wrapper.get('.abele-chat-msg__tool-summary')
    expect(summary.classes()).not.toContain('abele-chat-msg__tool-link')
    expect(summary.attributes('role')).toBeUndefined()
    expect(summary.attributes('tabindex')).toBeUndefined()
    await summary.trigger('click')
    expect(opener).not.toHaveBeenCalled()
  }
)
