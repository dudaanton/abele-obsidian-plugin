import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { TFile } from 'obsidian'
import AiChatInput from '@/components/AiChatInput.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import GalleryViewer from '@/components/GalleryViewer.vue'
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
afterEach(() => { for (const w of mounted.splice(0)) w.unmount() })

it('shows a pending thumbnail and opens the plugin preview without sending', async () => {
  const w = mount(AiChatInput, { props: {
    isStreaming: false, isBusy: false, canContinue: false, tokenDisplay: '', scopeLabel: '',
  } })
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
  const w = mount(AiChatMessage, { props: { message: {
    id: 'sample', role: 'user', content: '', timestamp: 1, attachments: [image.path],
  } } })
  mounted.push(w)
  await w.get('.abele-chat-msg__attachments img').trigger('click')
  expect(w.findComponent(GalleryViewer).exists()).toBe(true)
  expect(w.findComponent(GalleryViewer).props('replaceAttachment')).toBeUndefined()
})

it('opens image embeds in assistant replies in the plugin preview', async () => {
  const w = mount(AiChatMessage, { props: { message: {
    id: 'reply', role: 'assistant', content: `![[${image.path}]]`, timestamp: 1,
  } } })
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
