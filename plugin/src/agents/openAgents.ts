import { createApp, h } from 'vue'
import AgentsListDialog from '@/components/AgentsListDialog.vue'

let closeCurrent: (() => void) | undefined
/** One command and one modal, whichever shared header or ribbon opened it. */
export function openAgents(): void {
  if (closeCurrent) return
  const host = document.body.createDiv()
  const app = createApp({ render: () => h(AgentsListDialog, { onClose: closeAgents }) })
  closeCurrent = () => {
    app.unmount()
    host.remove()
    closeCurrent = undefined
  }
  app.mount(host)
}
export function closeAgents(): void {
  closeCurrent?.()
}
