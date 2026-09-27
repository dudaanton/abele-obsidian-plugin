/**
 * Dictation into a note.
 *
 * The same recorder the chat uses, in a dialog of its own, because a note has no place to put
 * a panel: the editor is the whole pane. What comes back is the words, which the caller drops
 * in at the cursor.
 *
 * Mounted by hand rather than through `VueRenderer`: that one finds its mount point through
 * the main document, and a note can be open in a window of its own.
 */
import type { App } from 'obsidian'
import { ShellModal } from '@/modal/ShellModal'
import { createApp, type App as VueApp } from 'vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'

class VoiceModal extends ShellModal {
  private vue: VueApp | null = null

  constructor(
    app: App,
    private readonly done: (text: string | null) => void
  ) {
    super(app, { title: 'Dictate' })
  }

  onOpen(): void {
    super.onOpen()
    const mount = this.bodyEl.doc.win.createDiv()
    this.bodyEl.appendChild(mount)

    this.vue = createApp(VoiceRecorder, {
      autoStart: true,
      onText: (text: string) => {
        this.done(text)
        this.close()
      },
      onClose: () => this.close(),
    })
    this.vue.mount(mount)
  }

  onClose(): void {
    // Unmounting is what stops the recorder and lets go of the microphone: the component
    // releases it in `onBeforeUnmount`, and a dialog dismissed with Escape gets here too.
    this.vue?.unmount()
    this.vue = null
    this.bodyEl.empty()
    this.done(null)
    super.onClose()
  }
}

/** Opens the recorder and resolves with what was said, or `null` if nothing was. */
export function dictate(app: App): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const once = (text: string | null) => {
      if (settled) return
      settled = true
      resolve(text)
    }

    new VoiceModal(app, once).open()
  })
}
