import { createApp } from 'vue'
import FileChats from '@/components/FileChats.vue'

/** What the code view hands the list: the file it holds, rewritten as that changes. */
export interface FileChatsModel {
  path: string
}

/**
 * Mounts the list of chats linked to a script under the code, into `parent`.
 *
 * Its own small app, the way the book reader mounts its own: the code view is a plain
 * Obsidian view with no Vue of its own, and the list needs nothing from the plugin's main app
 * — its cards read the chat index and open a chat in the sidebar, which leaves the script's
 * tab where it is. `model` must be reactive. Answers the unmount.
 */
export function mountFileChats(parent: HTMLElement, model: FileChatsModel): () => void {
  const app = createApp(FileChats, { model })
  app.mount(parent)
  return () => app.unmount()
}
