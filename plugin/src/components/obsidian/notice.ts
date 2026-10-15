import { Notice } from 'obsidian'
import NoticeActions from './NoticeActions.vue'
import { renderKit, unrenderKit } from './mount'

/** One button of a notice: what it says, what pressing it does, in a few words, and the action. */
export interface NoticeAction {
  text: string
  tooltip: string
  /** The one action the notice is there for, drawn as Obsidian's `mod-cta`. */
  accent?: boolean
  run: () => void
}

export interface ActionNotice {
  readonly notice: Notice
  /** Takes the buttons out and closes the notice; safe to call again. */
  hide(): void
}

/**
 * An Obsidian notice holding a message and a row of the kit's buttons. They are rendered
 * synchronously into the notice's own message element, in the notice's own document, so the
 * notice has its size when Obsidian places it; no focus is requested. An action does not close
 * the notice by itself — it calls `hide` when it should.
 */
export function noticeWithActions(
  text: string,
  actions: NoticeAction[],
  duration = 0
): ActionNotice {
  const notice = new Notice(createFragment(), duration)
  renderKit(notice.messageEl, NoticeActions, { text, actions })
  return {
    notice,
    hide() {
      unrenderKit(notice.messageEl)
      notice.hide()
    },
  }
}
