import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { TFile } from 'obsidian'
import AiChatInput from '@/components/AiChatInput.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import GalleryViewer from '@/components/GalleryViewer.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import ChatToolImage from '@/components/chat/ChatToolImage.vue'
import ChatPicture from '@/components/ChatPicture.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { h } from 'vue'
import { useVault } from '../helpers/testEnv'
import { resolveAttachmentsForApi } from '@/ai/attachments'

vi.mock('@/editor/embeddedEditor', () => import('../helpers/fakeNoteEditor'))
const mounted: Array<{ unmount(): void }> = []
let image: TFile
beforeEach(() => {
  const app = useVault([{ path: 'Attachments/sample-image.png', content: 'picture' }])
  image = app.vault.getAbstractFileByPath('Attachments/sample-image.png') as TFile
  ;(app.vault as any).getResourcePath = (f: TFile) => `app://sample/${f.path}`
  document.body.replaceChildren()
})
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
})

it('shows a generated filename with the full path in its tooltip', () => {
  const w = mount(ChatToolImage, {
    props: {
      message: {
        id: 'caption',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'generate_image',
        toolStatus: 'approved',
        toolResult: `Image saved: ${image.path}`,
        toolImagePath: image.path,
      },
    },
  })
  mounted.push(w)
  const caption = w.get('.abele-chat-msg__image-link')
  expect(caption.text()).toBe('sample-image.png')
  expect(caption.attributes('title')).toBe(image.path)
})

it('replaces a failed pending picture with a file glyph and retries updated media', async () => {
  const w = mount(ChatPicture, { props: { path: image.path, pending: true } })
  mounted.push(w)
  await w.get('img').trigger('error')
  expect(w.find('img').exists()).toBe(false)
  expect(w.findComponent(Icon).props('icon')).toBe('file')
  expect(w.text()).toContain('sample-image.png')
  await w.setProps({ version: 1 })
  expect(w.find('img').exists()).toBe(true)
})

it('shows a pending thumbnail and opens the plugin preview without sending', async () => {
  const w = mount(AiChatInput, {
    props: {
      isStreaming: false,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
    },
  })
  mounted.push(w)
  w.vm.addAttachment(image)
  await w.vm.$nextTick()
  const thumb = w.get('.abele-chat-input__attachments img')
  expect(thumb.attributes('src')).toContain(image.path)
  await thumb.trigger('click')
  expect(w.findComponent(GalleryViewer).exists()).toBe(true)
  expect(w.emitted('send')).toBeUndefined()
  expect(w.findComponent(GalleryViewer).props('replaceAttachment')).toBe(image.path)
})

it('opens sent image attachments in the plugin preview', async () => {
  const w = mount(AiChatMessage, {
    props: {
      message: {
        id: 'sample',
        role: 'user',
        content: '',
        timestamp: 1,
        attachments: [image.path],
      },
    },
  })
  mounted.push(w)
  await w.get('.abele-chat-msg__attachments img').trigger('click')
  expect(w.findComponent(GalleryViewer).exists()).toBe(true)
  expect(w.findComponent(GalleryViewer).props('replaceAttachment')).toBeUndefined()
})

it('opens image embeds in assistant replies in the plugin preview', async () => {
  const w = mount(AiChatMessage, {
    props: {
      message: {
        id: 'reply',
        role: 'assistant',
        content: `![[${image.path}]]`,
        timestamp: 1,
      },
    },
  })
  mounted.push(w)
  const embed = document.createElement('span')
  embed.className = 'internal-embed'
  embed.setAttribute('src', image.path)
  const img = document.createElement('img')
  img.src = `app://sample/${image.path}`
  embed.append(img)
  w.get('.abele-markdown').element.append(embed)
  img.click()
  await w.vm.$nextTick()
  expect(w.findComponent(GalleryViewer).exists()).toBe(true)
})

it('gives the model both the picture and its exact file path', async () => {
  const parts = await resolveAttachmentsForApi([image.path])
  expect(parts).toContainEqual({ type: 'text', text: `[Image: ${image.path}]` })
  expect(parts).toContainEqual({ type: 'image_url', image_url: { url: `vault:${image.path}` } })
})

it('keeps a saved generated image visible after its run folds', async () => {
  const message = {
    id: 'generated',
    role: 'tool-call' as const,
    content: '',
    timestamp: 1,
    toolName: 'generate_image',
    toolStatus: 'approved' as const,
    toolResult: `Image saved: ${image.path}`,
    toolImagePath: image.path,
  }
  const w = mount(ChatToolRun, {
    props: { id: 'run', calls: [message], open: true },
    slots: {
      default: () => h(AiChatMessage, { message }),
      results: () => h(ChatToolImage, { message }),
    },
  })
  mounted.push(w)
  expect(w.findAll('.abele-chat-msg__image-preview')).toHaveLength(1)
  await w.setProps({ open: false })
  expect(w.find('.abele-chat-msg__image-preview').exists()).toBe(true)
  await w.get('.abele-chat-msg__image-preview').trigger('click')
  expect(w.findComponent(GalleryViewer).exists()).toBe(true)
  const saved = JSON.parse(JSON.stringify(message))
  const reopened = mount(ChatToolRun, {
    props: { id: 'run', calls: [saved], open: false },
    slots: { results: () => h(ChatToolImage, { message: saved }) },
  })
  mounted.push(reopened)
  expect(reopened.findAll('.abele-chat-msg__image-preview')).toHaveLength(1)
})

it('shows completion immediately but keeps no-image, failed and missing results empty', async () => {
  const message = {
    id: 'generated',
    role: 'tool-call' as const,
    content: '',
    timestamp: 1,
    toolName: 'generate_image',
    toolStatus: 'approved' as const,
  }
  const w = mount(ChatToolImage, { props: { message } })
  mounted.push(w)
  expect(w.find('img').exists()).toBe(false)
  const completed = {
    ...message,
    toolResult: `Image saved: ${image.path}`,
    toolImagePath: image.path,
  }
  await w.setProps({ message: completed })
  expect(w.get('img').attributes('src')).toContain(image.path)
  for (const invalid of [
    { ...completed, toolImagePath: undefined },
    { ...completed, toolStatus: 'rejected' as const },
    { ...completed, toolResult: 'No image returned' },
    {
      ...completed,
      toolResult: 'Image saved: Attachments/missing.png',
      toolImagePath: 'Attachments/missing.png',
    },
  ]) {
    await w.setProps({ message: invalid })
    expect(w.find('img').exists()).toBe(false)
  }
})
