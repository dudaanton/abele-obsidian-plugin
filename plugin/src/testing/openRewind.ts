import { createApp } from 'vue'
import { TFile } from 'obsidian'
import AiRewindDialog from '@/components/AiRewindDialog.vue'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * Opens the rewind dialog on its own, for the layout probes and the e2e tier, over a log of
 * its own kept in memory: `edit` is rewritten and `create` made while the log records, as an
 * agent's turn would, and the dialog lists both. Nothing is written to the plugin's folder.
 * Resolves with the dialog's log, so a test can see what a button did to it.
 */
export async function openRewind(edit: string, create: string): Promise<ChatRewind> {
  const { app } = GlobalStore.getInstance()
  const rewind = new ChatRewind(app, { key: () => 'probe', turn: () => 'probe-turn' }, memoryStore())
  const end = rewind.begin('write')
  try {
    const file = app.vault.getAbstractFileByPath(edit)
    if (file instanceof TFile) {
      await app.vault.process(file, (text) => `${text}\nA line the probe's agent added.\n`)
    }
    await app.vault.create(create, 'A note the probe agent made.\n')
  } finally {
    await end()
  }

  const host = document.body.createDiv()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    view.unmount()
    host.remove()
  }
  const view = createApp(AiRewindDialog, {
    rewind,
    mode: 'since',
    messageId: 'probe-turn',
    since: 0,
    onClose: close,
  })
  view.mount(host)
  return rewind
}
