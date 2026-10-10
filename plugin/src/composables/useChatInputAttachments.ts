import { ref, type Ref } from 'vue'
import { Menu, TFile, Notice } from 'obsidian'
import { isHeicImport } from '@/media/imageImport'
import { imageFileForImport } from '@/media/importImageFile'
import { GlobalStore } from '@/stores/GlobalStore'
import { pickVaultFile } from '@/helpers/suggesters/VaultFilePicker'
import { pickChat } from '@/helpers/suggesters/ChatPicker'
import { ChatService } from '@/ai/ChatService'
import { importExternalFile } from '@/ai/attachments'
import type { ChatDraft } from '@/ai/types'
import { DraftImports, type ConversationOwner } from '@/ai/draftImports'

interface AttachmentProps {
  textOnly?: boolean
  ownsConversation?: (owner?: ConversationOwner) => boolean
  attachmentReady?: (path: string, owner?: ConversationOwner) => void
}
interface InputAttachmentOptions {
  props: AttachmentProps
  draft: Ref<ChatDraft>
  owner: () => ConversationOwner | undefined
  fileInputEl: Ref<HTMLInputElement | null>
  emitAttachFile: (path: string, owner?: ConversationOwner) => void
}

/** Picker, paste and drop delivery into the conversation captured before any await. */
export function useChatInputAttachments(options: InputAttachmentOptions) {
  const { props, draft, owner: draftOwner, fileInputEl, emitAttachFile } = options

  const showAttachMenu = (event: MouseEvent) => {
    const menu = new Menu()
    menu.addItem((item) => {
      item.setTitle('From vault').setIcon('vault').onClick(pickFromVault)
    })
    menu.addItem((item) => {
      item.setTitle('From disk').setIcon('hard-drive').onClick(pickFromDisk)
    })
    menu.addItem((item) => {
      item.setTitle('Agent chat').setIcon('messages-square').onClick(pickFromChats)
    })
    menu.showAtMouseEvent(event)
  }

  /**
   * Another chat, for the agent to read what was said in it. Not announced as `attachFile`: that
   * puts the file into the chat's scope, and a chat log in scope would be the whole log — every
   * note the other agent read — where an attachment is only the conversation.
   */
  const pickFromChats = async () => {
    const { app } = GlobalStore.getInstance()
    const owner = draftOwner()
    const state = importsFor(draft.value, owner)
    const current = ChatService.getInstance().activeSession.value?.currentChatFile.value?.path
    const file = await pickChat(app, current)
    const target = state.target
    if (
      file &&
      state.active &&
      (props.ownsConversation?.(owner) ?? true) &&
      !target.attachments.some((a) => a.path === file.path)
    ) {
      target.attachments = [...target.attachments, file]
    }
  }

  const pickFromVault = async () => {
    const { app } = GlobalStore.getInstance()
    const owner = draftOwner()
    const state = importsFor(draft.value, owner)
    const file = await pickVaultFile(app)
    if (file && state.active && (props.ownsConversation?.(owner) ?? true))
      attachToDraft(file, state.target, owner)
  }

  const pickFromDisk = () => {
    fileInputEl.value?.click()
  }

  const onFileSelected = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const fileList = input.files ? Array.from(input.files) : []
    input.value = ''
    if (!fileList.length) return

    await importFiles(fileList)
  }

  const onPaste = async (e: ClipboardEvent) => {
    if (props.textOnly) return
    const items = e.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    if (!files.length) return
    e.preventDefault()

    await importFiles(files)
  }

  // ── Drag & drop ──

  const isDragging = ref(false)
  let dragLeaveTimer: number | null = null

  const onDragOver = () => {
    if (props.textOnly) return
    if (dragLeaveTimer) {
      window.clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }
    isDragging.value = true
  }

  const onDragLeave = () => {
    // Small delay to prevent flicker when moving between child elements
    dragLeaveTimer = window.setTimeout(() => {
      isDragging.value = false
    }, 50)
  }

  const onDrop = async (e: DragEvent) => {
    if (props.textOnly) return
    isDragging.value = false
    const dt = e.dataTransfer
    if (!dt) return

    console.debug('[Abele drop]', {
      types: [...dt.types],
      text: dt.getData('text/plain'),
      html: dt.getData('text/html'),
      files: dt.files?.length,
    })

    // 1. Obsidian internal drag — files from file explorer
    // Obsidian puts the path in text/plain and may also provide Files
    const textData = dt.getData('text/plain')?.trim()
    if (textData) {
      const { app } = GlobalStore.getInstance()
      let handled = false
      for (const line of textData
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)) {
        // Both URI and wikilink drags must work here now that this event stops at the composer.
        const fileParam = line.match(/[?&]file=([^&]+)/)
        const path = fileParam ? decodeURIComponent(fileParam[1]) : line.replace(/^\[\[|\]\]$/g, '')
        const file = app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) {
          addAttachment(file)
          handled = true
        }
      }
      if (handled) return
    }

    // 2. External files from OS
    const fileList = dt.files ? Array.from(dt.files) : []
    await importFiles(fileList)
  }

  function importsFor(target: ChatDraft, owner?: ConversationOwner): DraftImports<ChatDraft> {
    if (!target.imports) target.imports = new DraftImports(target, owner)
    return target.imports
  }

  function attachToDraft(file: TFile, target: ChatDraft, owner?: ConversationOwner): void {
    const state = importsFor(target, owner)
    const owns = props.ownsConversation ?? (() => true)
    const ready = props.attachmentReady ?? emitAttachFile
    const current = state.target
    if (!state.active || !owns(owner) || current.attachments.some((a) => a.path === file.path))
      return
    current.attachments = [...current.attachments, file]
    if (!isHeicImport(file.path)) {
      ready(file.path, owner)
      return
    }
    const done = state.begin(file.path)
    if (!done) return
    void imageFileForImport(GlobalStore.getInstance().app, file)
      .then((converted) => {
        const current = state.target
        if (!state.active || !owns(owner) || !current.attachments.some((a) => a.path === file.path))
          return
        current.attachments = current.attachments.map((a) => (a.path === file.path ? converted : a))
        ready(converted.path, owner)
      })
      .catch((err) => {
        new Notice(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
      })
      .finally(done)
  }

  const addAttachment = (file: TFile) => attachToDraft(file, draft.value, draftOwner())

  /** Capture once before any await: disk, paste and whole-chat drops obey the same ownership. */
  async function importFiles(files: File[]): Promise<void> {
    const target = draft.value
    const owner = draftOwner()
    const state = importsFor(target, owner)
    const owns = props.ownsConversation ?? (() => true)
    const ready = props.attachmentReady ?? emitAttachFile
    const done = state.begin(`external-${Date.now()}-${Math.random()}`)
    if (!done) return
    try {
      for (const file of files) {
        if (!state.active || !owns(owner)) break
        try {
          const imported = await importExternalFile(file)
          const current = state.target
          if (state.active && owns(owner)) {
            // importExternalFile already attempted normalization, including non-convertible HEIC.
            if (!current.attachments.some((a) => a.path === imported.path)) {
              current.attachments = [...current.attachments, imported]
              ready(imported.path, owner)
            }
          }
        } catch (err) {
          new Notice(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
        }
      }
    } finally {
      done?.()
    }
  }

  return {
    showAttachMenu,
    onFileSelected,
    onPaste,
    isDragging,
    onDragOver,
    onDragLeave,
    onDrop,
    addAttachment,
    importFiles,
  }
}
