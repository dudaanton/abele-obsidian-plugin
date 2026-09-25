/**
 * Attaching a chat to a note by hand, from either end.
 *
 * From a note: *Attach a chat…* in its file menu — the explorer, a tab's header and its "more
 * options" all build that one menu — and as a command for the note in front. It picks a chat
 * out of the history. From a chat: the link button in its header, whose menu attaches the chat
 * to the note in front or to one picked, and detaches it from the notes it is attached to.
 * Detaching from the note's end is the button on the chat's card under the note.
 *
 * All of it is `chatNoteLinks`: the same link a chat makes by writing to a note, so the chat's
 * card under the note looks the same whichever way it got there.
 */
import { Menu, Notice, TFile, type App, type Plugin, type TAbstractFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatStorage } from '@/ai/ChatStorage'
import type { ChatSession } from '@/ai/ChatSession'
import { attachNote, detachNote } from '@/ai/chatNoteLinks'
import { pickChat } from '@/helpers/suggesters/ChatPicker'
import { pickNote } from '@/helpers/suggesters/NotePicker'

export const ATTACH_CHAT_TITLE = 'Attach a chat…'
export const ATTACH_ICON = 'link'
export const DETACH_ICON = 'unlink'

/** Whether a chat can be attached to this: a note, which has a footer to show it under. */
export function canAttachTo(file: TAbstractFile | null | undefined): file is TFile {
  return file instanceof TFile && file.extension === 'md'
}

const titleOf = (chatPath: string): string =>
  ChatStorage.getInstance()
    .getHistory()
    .find((e) => e.path === chatPath)?.title || 'the chat'

const nameOf = (notePath: string): string => notePath.replace(/^.*\//, '').replace(/\.md$/, '')

/** Picks a chat for this note and attaches it. Answers whether one was attached. */
export async function attachChatToNote(note: TFile): Promise<boolean> {
  const { app } = GlobalStore.getInstance()
  const chat = await pickChat(app, undefined, {
    hide: (entry) => entry.notes?.some((n) => n.path === note.path) ?? false,
    placeholder: `Attach a chat to ${nameOf(note.path)}...`,
  })
  if (!chat) return false
  if (!(await attachNote(chat.path, note.path))) return false
  new Notice(`Attached “${titleOf(chat.path)}” to ${nameOf(note.path)}`)
  return true
}

/** Attaches a chat to one note, and says so — the chat's end has no card to show it. */
async function attachFromChat(chatPath: string, notePath: string): Promise<void> {
  if (await attachNote(chatPath, notePath)) new Notice(`Attached to ${nameOf(notePath)}`)
}

async function detachFromChat(chatPath: string, notePath: string): Promise<void> {
  if (await detachNote(chatPath, notePath)) new Notice(`Detached from ${nameOf(notePath)}`)
}

/**
 * The menu behind the link button in a chat's header: attach to the note in front, attach to
 * another, and one line per note it is attached to, to detach it. Empty for a chat that has
 * no file yet — nothing to write the link into.
 */
export function chatNotesMenu(session: ChatSession): Menu {
  const { app } = GlobalStore.getInstance()
  // Drawn by the page, like every other menu the plugin opens from its own views: the native
  // one on a Mac is a different widget from the sidebar it came out of, and a phone has none.
  const menu = new Menu().setUseNativeMenu(false)
  const chatPath = session.currentChatFile.value?.path
  if (!chatPath) return menu

  const linked = session.touched.value.map((n) => n.path)
  const active = app.workspace.getActiveFile()
  const run = (job: Promise<void>): void => {
    job.catch((e: unknown) => {
      console.error('[Abele] Attaching the chat failed:', e)
      const reason = e instanceof Error ? e.message : 'unknown error'
      new Notice(`Could not change the chat's notes: ${reason}`)
    })
  }

  if (canAttachTo(active) && !linked.includes(active.path)) {
    menu.addItem((item) =>
      item
        .setTitle(`Attach to ${active.basename}`)
        .setIcon(ATTACH_ICON)
        .onClick(() => run(attachFromChat(chatPath, active.path)))
    )
  }
  menu.addItem((item) =>
    item
      .setTitle('Attach to a note…')
      .setIcon('file-search')
      .onClick(() => run(pickAndAttach(app, chatPath, linked, active)))
  )

  if (linked.length) menu.addSeparator()
  for (const path of linked) {
    menu.addItem((item) =>
      item
        .setTitle(`Detach from ${nameOf(path)}`)
        .setIcon(DETACH_ICON)
        .onClick(() => run(detachFromChat(chatPath, path)))
    )
  }
  return menu
}

async function pickAndAttach(
  app: App,
  chatPath: string,
  linked: string[],
  active: TFile | null
): Promise<void> {
  const note = await pickNote(app, {
    first: active?.path,
    exclude: new Set(linked),
    placeholder: 'Attach this chat to a note...',
  })
  if (note) await attachFromChat(chatPath, note.path)
}

function run(note: TFile): void {
  void attachChatToNote(note).catch((e: unknown) => {
    console.error('[Abele] Attaching a chat failed:', e)
    new Notice(`Could not attach the chat: ${e instanceof Error ? e.message : 'unknown error'}`)
  })
}

const aiEnabled = () => AbeleConfig.getInstance().ai.enabled

export function registerAttachChat(plugin: Plugin): void {
  const { workspace } = plugin.app

  plugin.registerEvent(
    workspace.on('file-menu', (menu, file) => {
      if (!aiEnabled() || !canAttachTo(file)) return
      menu.addItem((item) =>
        item
          .setTitle(ATTACH_CHAT_TITLE)
          .setIcon(ATTACH_ICON)
          .onClick(() => run(file))
      )
    })
  )

  plugin.addCommand({
    id: 'attach-chat-to-current-note',
    name: 'Attach a chat to current note',
    icon: ATTACH_ICON,
    checkCallback: (checking) => {
      const file = workspace.getActiveFile()
      if (!aiEnabled() || !canAttachTo(file)) return false
      if (!checking) run(file)
      return true
    },
  })
}
