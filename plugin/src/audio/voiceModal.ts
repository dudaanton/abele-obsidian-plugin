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
import { App, Modal } from 'obsidian'
import { createApp, type App as VueApp } from 'vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'

class VoiceModal extends Modal {
  private vue: VueApp | null = null

  constructor(
    app: App,
    private readonly done: (text: string | null) => void
  ) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Dictate')

    const mount = this.contentEl.doc.win.createDiv()
    this.contentEl.appendChild(mount)

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
    this.contentEl.empty()
    this.done(null)
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
