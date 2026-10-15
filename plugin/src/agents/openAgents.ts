import { h } from 'vue'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import { mountKit } from '@/components/obsidian/mount'

let closeCurrent: (() => void) | undefined
/** One command and one modal, whichever shared header or ribbon opened it. */
export function openAgents(): void {
  if (closeCurrent) return
  const host = document.body.createDiv()
  closeCurrent = () => {
    closeCurrent = undefined
    app.unmount()
  }
  const app = mountKit(
    host,
    { render: () => h(AgentsListDialog, { onClose: closeAgents }) },
    null,
    { remove: true }
  )
}
export function closeAgents(): void {
  closeCurrent?.()
}
