/**
 * A drawing attached to the chat in front, from its tab (`drawing/askAgent.ts`): turned into a
 * PNG — all of it, or the part picked — saved where the vault keeps attachments, and handed to
 * the chat's input as a picture to send. Nothing is sent by itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { attachDrawingToChat, drawingAttachmentName } from '@/drawing/askAgent'
import type { PendingInput } from '@/ai/ChatService'
import { useVault } from '../helpers/testEnv'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function fakeChats() {
  return {
    pendingInput: ref<PendingInput | null>(null),
    revealSidebar: vi.fn(async () => {}),
  }
}

describe('a drawing attached to the chat', () => {
  let app: ReturnType<typeof useVault>
  let asked: { name: string; source: string }[]

  beforeEach(() => {
    app = useVault([{ path: 'Sketches/Plan.svg', raw: '<svg></svg>' }])
    asked = []
    Object.assign(app.fileManager, {
      getAvailablePathForAttachment: async (name: string, source: string) => {
        asked.push({ name, source })
        return `Attachments/${name}`
      },
    })
  })

  it('is named for the drawing, and for the part when only a part goes', () => {
    expect(drawingAttachmentName('Plan', false)).toBe('Plan.png')
    expect(drawingAttachmentName('Plan', true)).toBe('Plan (part).png')
  })

  it('goes as a PNG saved with the attachments, into the input of the chat in front', async () => {
    const chats = fakeChats()
    const drawing = app.vault.getAbstractFileByPath('Sketches/Plan.svg') as never
    const png = vi.fn(async () => new Blob([PNG], { type: 'image/png' }))
    const made = await attachDrawingToChat(app as never, drawing, false, png, chats as never)

    expect(png).toHaveBeenCalledOnce()
    expect(asked).toEqual([{ name: 'Plan.png', source: 'Sketches/Plan.svg' }])
    expect(made?.path).toBe('Attachments/Plan.png')
    const bytes = new Uint8Array(await app.vault.readBinary(made as never))
    expect([...bytes]).toEqual([...PNG])
    expect(chats.pendingInput.value).toEqual({
      text: '',
      attachments: ['Attachments/Plan.png'],
      focus: true,
    })
    expect(chats.revealSidebar).toHaveBeenCalledOnce()
  })

  it('leaves the chat alone when the picture cannot be made', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const chats = fakeChats()
    const drawing = app.vault.getAbstractFileByPath('Sketches/Plan.svg') as never
    const made = await attachDrawingToChat(
      app as never,
      drawing,
      true,
      async () => {
        throw new Error('No picture')
      },
      chats as never
    )
    expect(made).toBeNull()
    expect(chats.pendingInput.value).toBeNull()
    expect(app.vault.getAbstractFileByPath('Attachments/Plan (part).png')).toBeNull()
  })
})
