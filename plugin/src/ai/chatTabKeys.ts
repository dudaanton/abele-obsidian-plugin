/**
 * The keys the chat's tabs answer to while the chat has the focus, as a browser's tabs do.
 *
 * Through a keymap scope rather than a raw `keydown`: Obsidian runs its own hotkeys on the
 * window's capture phase, ahead of any listener of ours, so Cmd+W there closed the whole sidebar
 * pane before a listener could say it meant the chat tab. A view's scope is the one Obsidian
 * consults first while that view is active, and anything not taken here goes on to its own.
 *
 * Outside the chat nothing here is consulted, so Obsidian's own keys are exactly as they were.
 */
import { Scope, type App } from 'obsidian'
import { ChatService } from './ChatService'
import { CHAT_TAB_KEYS, tabAlong, tabAt, type ChatTabAction } from './chatTabKeyMap'

export {
  CHAT_TAB_KEYS,
  keyLabel,
  stopTooltip,
  tabAlong,
  tabAt,
  withShortcut,
} from './chatTabKeyMap'
export type { ChatTabAction, ChatTabKey } from './chatTabKeyMap'

/**
 * Cmd+W on the chat tab in front: closed as its × closes it, saved and not deleted.
 *
 * The last tab, already blank, is left alone rather than taking the pane with it: closing it
 * would only put the same blank chat back, and the pane closing instead would surprise
 * somebody who pressed the key once too often. The key is still taken, so Obsidian does not
 * close the sidebar under it.
 */
export function closeActiveTab(chats: ChatService): void {
  const active = chats.activeTabId.value
  if (!active) return
  if (chats.tabOrder.value.length === 1 && ChatService.isBlank(chats.getSession(active))) return
  void chats.closeTab(active)
}

export function runChatTabAction(action: ChatTabAction, chats = ChatService.getInstance()): void {
  const order = chats.tabOrder.value
  const active = chats.activeTabId.value
  const go = (id: string | null) => {
    if (id && id !== active) chats.switchTab(id)
  }
  switch (action) {
    case 'close':
      return closeActiveTab(chats)
    case 'create':
      void chats.newTab()
      return
    case 'reopen':
      return void chats.reopenClosedTab()
    case 'previous':
      return go(tabAlong(order, active, -1))
    case 'next':
      return go(tabAlong(order, active, 1))
  }
}

/** Stops the agent on Ctrl+C, when the chat on screen says it is the one to stop. */
const stopKeys = new Set<() => boolean>()

/** A chat on screen offers Ctrl+C a way to stop its agent; the returned function withdraws it. */
export function onStopKey(stop: () => boolean): () => void {
  stopKeys.add(stop)
  return () => stopKeys.delete(stop)
}

/**
 * Control+C alone, as a terminal stops what runs in it. The Control key on every platform, a
 * Mac's included, so Cmd+C stays copy there. A Latin letter is read as typed; any other layout
 * by the key's place, where the C is.
 */
function isStopKey(evt: KeyboardEvent): boolean {
  if (!evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey) return false
  const key = evt.key.toLowerCase()
  return /^[a-z]$/.test(key) ? key === 'c' : evt.code === 'KeyC'
}

/** Text is selected somewhere on the page: Ctrl+C is its copy, never a stop. */
function textSelected(evt: KeyboardEvent): boolean {
  const target = evt.target as Node | null
  const doc = target?.ownerDocument ?? (target as Document | null)?.defaultView?.document
  const selection = (doc ?? activeDocument).getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().length > 0
}

/** Registers every chat-tab key on `scope`. */
export function registerChatTabKeys(scope: Scope, chats = () => ChatService.getInstance()): void {
  scope.register(['Mod'], 'o', () => {
    chats().treeRequest.value++
    return false
  })
  for (const action of Object.keys(CHAT_TAB_KEYS) as ChatTabAction[]) {
    for (const { modifiers, key } of CHAT_TAB_KEYS[action]) {
      scope.register(modifiers, key, () => {
        runChatTabAction(action, chats())
        return false
      })
    }
  }
  for (let n = 1; n <= 9; n++) {
    scope.register(['Mod'], String(n), () => {
      const chosen = tabAt(chats().tabOrder.value, n)
      if (chosen && chosen !== chats().activeTabId.value) chats().switchTab(chosen)
      return false
    })
  }
  // Ctrl+C, and only when a chat stops something and no text is selected; otherwise the key
  // goes on where it went before. A catch-all, because a binding for the key itself would end
  // its way through the scopes even when it did nothing.
  scope.register(null, null, (evt: KeyboardEvent) => {
    if (!isStopKey(evt) || textSelected(evt)) return
    for (const stop of stopKeys) if (stop()) return false
    return
  })
}

let shared: Scope | null = null

/**
 * The one scope every chat pane and its composer share: the tabs are one bar however many
 * panes show it. Its parent is the app's scope, so whatever it does not take reaches
 * Obsidian's hotkeys as before.
 */
export function chatTabScope(app: App): Scope {
  if (!shared) {
    shared = new Scope(app.scope)
    registerChatTabKeys(shared)
  }
  return shared
}

/** Forgets the shared scope, for the plugin's unload. */
export function resetChatTabScope(): void {
  shared = null
}
