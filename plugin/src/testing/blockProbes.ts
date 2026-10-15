import { showOffer } from '@/changelog/register'
import { WaitingScriptsNotice } from '@/scripting/scriptReview'
import { allowTemplateExecution } from '@/templates/TemplateTrust'
import { renderStatus, type SyncStatus } from '@/sync/status'
import ChatBranchSwitch from '@/components/ChatBranchSwitch.vue'
import type { BranchChoice } from '@/ai/chatBranches'
import { mountKit } from '@/components/obsidian/mount'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ParsedScript } from '@/scripting/types'

/**
 * Small pieces drawn into elements Obsidian hands the plugin — notices with buttons, the sync
 * item, the branch menu — put on screen on their own, for the e2e tier to look at and measure.
 */
export const blockProbes = {
  /** The update offer, as the changelog raises it; returns what takes it down. */
  updateOffer: (from: string, to: string) => showOffer(GlobalStore.getInstance().app, { from, to }),
  /** The notice for scripts waiting to be confirmed, over a stand-in list; returns its hide. */
  waitingScripts(names: string[]): () => void {
    const scripts = names.map(
      (name) => ({ path: `${name}.js`, hash: 'probe', meta: { name } }) as unknown as ParsedScript
    )
    const notice = new WaitingScriptsNotice({
      waitingScripts: () => scripts,
      reviewWaiting: async () => {},
    })
    notice.announce()
    return () => notice.hide()
  },
  /** The notice a template with commands raises before it is confirmed on this device. */
  templateReview: (path: string, name: string, source: string) =>
    allowTemplateExecution(path, name, source, true),
  /** The sync item's inside, drawn into `el` as the status bar draws it. */
  syncStatus: (el: HTMLElement, status: SyncStatus) => renderStatus(el, status),
  /** A branch switch mounted into `el`; its count opens the menu of branches. */
  branchSwitch: (el: HTMLElement, choices: BranchChoice[], index: number) =>
    mountKit(el, ChatBranchSwitch, { choices, index }).unmount,
}
