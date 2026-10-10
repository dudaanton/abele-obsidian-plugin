import { deferredCleanup } from '@/helpers/deferredCleanup'
import { MarkdownView, Notice, TFile, TFolder } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createNoteInGroup } from '@/commands/createNoteInGroup'
import { registerNoteMenu } from '@/commands/noteMenu'
import { NOTE_ACTIONS } from '@/commands/noteActions'
import { AI_SIDEBAR_VIEW_TYPE } from '@/views/AiSidebarView'
import { CODE_VIEW_TYPE } from '@/views/CodeView'
import { ChatService } from '@/ai/ChatService'
import { previewImage } from '@/commands/utilityDialogs'
import { openChat } from '@/ai/openChat'

import { SyncService } from '@/sync/SyncService'
import type { Plugin } from 'obsidian'

/** Startup section; called at its original lifecycle position. */
export function registerWorkspaceEvents(plugin: Plugin) {
  const orphanCleanup = deferredCleanup(() => GlobalStore.getInstance().cleanupOrphanedWidgets())
  plugin.register(() => orphanCleanup.stop())
  plugin.registerEvent(
    plugin.app.workspace.on('css-change', () => {
      GlobalStore.getInstance().themeVersion.value++
    })
  )

  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', (leaf) => {
      const store = GlobalStore.getInstance()

      const viewType = leaf?.view.getViewType()
      if (viewType === 'empty') {
        store.currentFile.value = null
        return
      }

      // A chat file already in a leaf — a layout saved before chats were kept out of leaves
      // (`keepChatFilesOutOfLeaves`) — goes to the chat panel, and its leaf with it.
      if (leaf && viewType === CODE_VIEW_TYPE) {
        const file = (leaf.view as any).file as TFile | undefined
        if (file?.extension === 'abchat') {
          leaf.detach()
          void openChat(file)
          return
        }
      }

      if (leaf?.view.getViewType() !== 'markdown') return

      const file = (leaf.view as MarkdownView).file

      if (file) {
        store.currentFile.value = file
      }

      // Delayed cleanup for widgets whose DOM was removed without CodeMirror calling destroy().
      // The delay ensures CodeMirror's own destroy() runs first when it does fire.
      orphanCleanup.schedule()
    })
  )

  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file) => {
      // Add folders to the agent context.
      if (file instanceof TFolder && AbeleConfig.getInstance().ai.enabled) {
        menu.addItem((item) => {
          item
            .setTitle(NOTE_ACTIONS[0].title)
            .setIcon(NOTE_ACTIONS[0].icon)
            .onClick(async () => {
              const chatService = ChatService.getInstance()
              const session = chatService.activeSession.value
              if (!session) return
              session.scopeResolver.addFolder(file.path)
              session.scopeResolver.invalidate()
              const { workspace } = plugin.app
              let leaf = workspace.getLeavesOfType(AI_SIDEBAR_VIEW_TYPE)[0] ?? null
              if (!leaf) {
                leaf = workspace.getRightLeaf(false)
                await leaf.setViewState({ type: AI_SIDEBAR_VIEW_TYPE, active: true })
              }
              void workspace.revealLeaf(leaf)
            })
        })
        return
      }

      if (!(file instanceof TFile)) return

      // "Open version history (Abele)" for a file the server holds versions of. Named after
      // the plugin because Obsidian's own Sync puts an "Open version history" in plugin same
      // menu. Shown only on a device that is connected: on every other one the dialog could
      // only say so.
      if (SyncService.getInstance().isConnected()) {
        menu.addItem((item) => {
          item
            .setTitle('Open version history (Abele)')
            .setIcon('history')
            .onClick(() => {
              GlobalStore.getInstance().versionHistoryPath.value = file.path
            })
        })
      }

      // "Preview" for images
      const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
      if (IMAGE_EXTENSIONS.includes(file.extension.toLowerCase())) {
        menu.addItem((item) => {
          item
            .setTitle('Preview')
            .setIcon('eye')
            .onClick(() => {
              void previewImage(file.path)
            })
        })
      }

      // "Create note in group" for markdown files
      if (file.extension === 'md') {
        menu.addItem((item) => {
          item
            .setTitle('Create note in group')
            .setIcon('file-plus')
            .onClick(() => createNoteInGroup(file))
        })
      }

      // "Open as code" for code files
      const ext = file.extension
      if (
        ![
          'base',
          'json',
          'css',
          'js',
          'ts',
          'html',
          'xml',
          'yaml',
          'yml',
          'csv',
          'txt',
          'svg',
        ].includes(ext)
      )
        return
      menu.addItem((item) => {
        item
          .setTitle('Open as code')
          .setIcon('code')
          .onClick(async () => {
            const leaf = plugin.app.workspace.getLeaf('tab')
            await leaf.setViewState({
              type: CODE_VIEW_TYPE,
              state: { file: file.path },
            })
            plugin.app.workspace.setActiveLeaf(leaf, { focus: true })
          })
      })
    })
  )

  registerNoteMenu(plugin)

  // "Find and create aliases" on right-click in editor
  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu, editor) => {
      const selection = editor.getSelection()
      if (!selection) return

      const wikilinkRegex = /\[\[([^\]|]+)\|([^\]]+)\]\]/g
      const links: { path: string; alias: string }[] = []
      let match: RegExpExecArray | null
      while ((match = wikilinkRegex.exec(selection)) !== null) {
        links.push({ path: match[1].trim(), alias: match[2].trim() })
      }
      if (!links.length) return

      menu.addItem((item) => {
        item
          .setTitle('Find and create aliases')
          .setIcon('link')
          .onClick(async () => {
            let created = 0
            for (const { path, alias } of links) {
              const file = plugin.app.metadataCache.getFirstLinkpathDest(path, '')
              if (!file) continue

              const cache = plugin.app.metadataCache.getFileCache(file)
              const existing = cache?.frontmatter?.aliases
              if (Array.isArray(existing) ? existing.includes(alias) : existing === alias) continue

              await plugin.app.fileManager.processFrontMatter(file, (fm) => {
                if (!fm.aliases) fm.aliases = []
                if (!Array.isArray(fm.aliases)) fm.aliases = [fm.aliases]
                fm.aliases.push(alias)
              })
              created++
            }

            if (created > 0) {
              new Notice(`Created ${created} alias${created > 1 ? 'es' : ''}`)
            } else {
              new Notice('All aliases already exist')
            }
          })
      })
    })
  )

  const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView)
  if (activeView?.file) {
    GlobalStore.getInstance().currentFile.value = activeView.file
  }
}
