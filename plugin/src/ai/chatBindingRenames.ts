import { ChatService } from './ChatService'
import { CommentService } from './CommentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatSelectionBindings } from './chatBindings'
import { renameBoundMessage } from './chatBindingEdits'
import { replyMarkdownText } from './replyMarkdown'
import { readChatSnapshot, rewriteChat } from './chatCopy'
import { serializeChat } from './ChatLog'

let renaming: Promise<void> = Promise.resolve()
/** Run after existing note/comment rename maintenance. Open sessions keep one writer. */
export function followChatBindingRename(oldPath: string, newPath: string): Promise<void> {
  const work = renaming.then(async () => {
    const { app } = GlobalStore.getInstance()
    const owner = (path: string) =>
      ChatService.getInstance().getSessionByFile(path) ??
      [...CommentService.getInstance().sessions.values()].find(
        (s) => s.currentChatFile.value?.path === path
      )
    for (const file of app.vault.getFiles().filter((f) => f.extension === 'abchat')) {
      const session = owner(file.path)
      if (session) {
        await new ChatSelectionBindings(session).rename(oldPath, newPath)
        continue
      }
      const { content: prior, parsed: loaded } = await readChatSnapshot(app, file)
      if (
        !loaded.metadata ||
        (!loaded.messages.some((m) =>
          m.decorationOperations?.some((op) => op.targetPath === oldPath)
        ) &&
          !loaded.metadata.bindingRecovery?.some((e) => e.targetPath === oldPath))
      )
        continue
      const messages = await Promise.all(
        loaded.messages.map((m) => renameBoundMessage(m, oldPath, newPath, replyMarkdownText))
      )
      const recovery = loaded.metadata.bindingRecovery?.map((entry) =>
        entry.targetPath === oldPath
          ? {
              ...entry,
              targetPath: newPath,
              operation:
                messages
                  .flatMap((m) => m.decorationOperations ?? [])
                  .find((op) => op.id === (entry.id ?? entry.operation?.id)) ?? entry.operation,
            }
          : entry
      )
      await rewriteChat(
        app,
        file,
        serializeChat({
          metadata: { ...loaded.metadata!, bindingRecovery: recovery },
          messages,
          internalMessages: loaded.internalMessages,
        }),
        (current) => {
          if (current !== prior || owner(file.path))
            throw new Error(
              'The binding source changed during card rename. Reopen it before making changes.'
            )
        }
      )
    }
  })
  renaming = work.catch(() => {})
  return work
}
