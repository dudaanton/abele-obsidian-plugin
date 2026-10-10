import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { TFile } from 'obsidian'
import { useChatInputAttachments } from '@/composables/useChatInputAttachments'
import { GlobalStore } from '@/stores/GlobalStore'
import { importExternalFile } from '@/ai/attachments'
import type { ChatDraft } from '@/ai/types'
import type { ConversationOwner } from '@/ai/draftImports'
import { useVault } from '../helpers/testEnv'

vi.mock('@/ai/attachments', async (original) => ({
  ...(await original<typeof import('@/ai/attachments')>()),
  importExternalFile: vi.fn(),
}))
afterEach(() => vi.restoreAllMocks())

describe('composer attachment delivery', () => {
  it('keeps a delayed external import in its captured draft after a tab change', async () => {
    useVault([{ path: 'sample.txt', raw: 'Sample file' }])
    const imported = GlobalStore.getInstance().app.vault.getAbstractFileByPath(
      'sample.txt'
    ) as TFile
    let complete!: (file: TFile) => void
    vi.mocked(importExternalFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const origin: ConversationOwner = { sessionId: 'first', version: 0 }
    let owner = origin
    const original: ChatDraft = { text: 'Original draft', attachments: [] }
    const draft = ref(original)
    const ready = vi.fn()
    const imports = useChatInputAttachments({
      props: { ownsConversation: () => true, attachmentReady: ready },
      draft,
      owner: () => owner,
      fileInputEl: ref(null),
      emitAttachFile: vi.fn(),
    })
    const pending = imports.importFiles([new File(['sample'], 'sample.txt')])
    expect(draft.value.imports?.pending.size).toBe(1)
    const firstDraft = draft.value
    owner = { sessionId: 'second', version: 0 }
    draft.value = { text: 'Second draft', attachments: [] }
    complete(imported)
    await pending
    expect(firstDraft.attachments.map((file) => file.path)).toEqual(['sample.txt'])
    expect(draft.value.attachments).toEqual([])
    expect(ready).toHaveBeenCalledWith('sample.txt', origin)
    expect(firstDraft.imports?.pending.size).toBe(0)
  })

  it('ignores paste and dragover for text-only sessions', async () => {
    useVault([])
    const imports = useChatInputAttachments({
      props: { textOnly: true },
      draft: ref({ text: '', attachments: [] }),
      owner: () => undefined,
      fileInputEl: ref(null),
      emitAttachFile: vi.fn(),
    })
    const preventDefault = vi.fn()
    await imports.onPaste({ preventDefault } as unknown as ClipboardEvent)
    imports.onDragOver()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(imports.isDragging.value).toBe(false)
  })
})
