import { type Editor, MarkdownView, Notice, TFile, TFolder, type TAbstractFile } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { commentHereInView } from '@/commands/commentCommands'
import { isScriptPath } from '@/scripting/scriptPath'
import { setCommentClickHandler, setCommentInfoSource } from '@/editor/CommentPlugin'
import { AiSidebarView } from '@/views/AiSidebarView'
import { SCRIPT_RUNS_VIEW_TYPE, ScriptRunsView } from '@/views/ScriptRunsView'
import { UserDocsView, openUserDocs } from '@/views/UserDocsView'
import { ChatService } from '@/ai/ChatService'
import { runChatTabAction } from '@/ai/chatTabKeys'
import { AgentsService } from '@/agents/AgentsService'
import { openAgents } from '@/agents/openAgents'
import { CommentService } from '@/ai/CommentService'
import { showMarkdown } from '@/scripting/formModal'
import { SCRIPT_API_DOCS } from '@/scripting/apiDocs'
import { SCRIPT_VIEW_DOCS } from '@/scripting/view/viewDocs'
import { ChatStorage } from '@/ai/ChatStorage'
import { followChatBindingRename } from '@/ai/chatBindingRenames'
import { renameDelegationIdentity } from '@/ai/delegationIdentity'
import { dictate } from '@/audio/voiceModal'
import { applyQuickButton } from '@/quickButton/mount'
import { openQuickMenu } from '@/quickButton/open'
import { HeaderCommands } from '@/headerButtons/viewActions'
import { moveFooterFolds } from '@/composables/useFooterFold'
import { moveFooterView } from '@/composables/useFooterView'
import type { Plugin } from 'obsidian'

interface AiFeatureHost extends Plugin {
  activateView(viewType: string): Promise<void>
}

/** Startup section; called at its original lifecycle position. */
export function registerAiFeatures(
  plugin: AiFeatureHost,
  setHeaderCommands: (commands: HeaderCommands) => void
) {
  const agents = AgentsService.getInstance()
  plugin.addCommand({ id: 'agents', name: 'Agents', icon: 'activity', callback: openAgents })
  const ribbon = plugin.addRibbonIcon('activity', 'Agents', openAgents)
  ribbon.addClass('abele-agents-ribbon')
  const badge = ribbon.createSpan({ cls: 'abele-agents-ribbon__badge' })
  plugin.register(
    watch(
      [agents.badge, agents.tooltip],
      ([value, tooltip]) => {
        badge.textContent = `${value.mark}${value.incomplete ? ' ?' : ''}`.trim()
        ribbon.setAttribute('aria-label', tooltip)
      },
      { immediate: true }
    )
  )
  plugin.app.workspace.onLayoutReady(() => {
    void agents.start()
  })
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && file.extension === 'abchat')
        void agents.updateFile(file, oldPath)
      else if (file instanceof TFolder) {
        for (const child of plugin.app.vault.getFiles())
          if (child.extension === 'abchat' && child.path.startsWith(`${file.path}/`)) {
            void agents.updateFile(child, oldPath + child.path.slice(file.path.length))
          }
      }
    })
  )
  plugin.registerEvent(
    plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'abchat') agents.deleted(file.path)
    })
  )
  const onChatFileChanged = (file: TAbstractFile) => {
    if (!(file instanceof TFile) || file.extension !== 'abchat') return
    // An open tab is not authoritative over a synced file. The adapter applies disk
    // decisions read-only; its own writes use the same monotonic resolution rule.
    agents.scheduleFile(file)
  }
  plugin.registerEvent(plugin.app.vault.on('create', onChatFileChanged))
  plugin.registerEvent(plugin.app.vault.on('modify', onChatFileChanged))
  // The editor's comment field reads plugin synchronously to draw each marker's icon.
  setCommentInfoSource(CommentService.getInstance())

  // The passage a comment is about is painted open only while the comment is on screen.
  // A sidebar collapsing is a resize and a tab coming forward is a leaf change; neither is
  // anything the editor would hear about on its own.
  plugin.registerEvent(
    plugin.app.workspace.on('resize', () => CommentService.getInstance().reconsiderOpen())
  )
  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', () =>
      CommentService.getInstance().reconsiderOpen()
    )
  )

  // The editor owns the press; the service owns what it opens. Injected rather than
  // imported, so `CommentPlugin` and `CommentService` do not import each other.
  setCommentClickHandler((ids) => {
    CommentService.getInstance().openFrom(ids)
  })

  plugin.addCommand({
    id: 'comment-here',
    name: 'Comment here',
    icon: 'message-circle-plus',
    editorCallback: (_editor: Editor, view: MarkdownView) => {
      void commentHereInView(view)
    },
  })

  // Beside the note actions, offered with or without a selection: a
  // comment at the caret is a question about the place, not about a passage.
  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu, _editor, view) => {
      // A `MarkdownFileInfo` has no `save()`, and a comment cannot wait on a buffer nobody
      // can flush — only a real pane is offered the item.
      if (!(view instanceof MarkdownView) || !view.file) return

      menu.addItem((item) => {
        item
          .setTitle('Ask here')
          .setIcon('message-circle-plus')
          .onClick(() => {
            void commentHereInView(view)
          })
      })
    })
  )

  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (!(file instanceof TFile)) return
      // A chat is renamed after its title; comments on its answers name it by path.
      if (file.extension === 'abchat') {
        renameDelegationIdentity(oldPath, file.path)
        void CommentService.getInstance().handleRename(oldPath, file.path)
        return
      }
      // A script's chats name it by path too, and follow it the same way a note's do.
      if (isScriptPath(oldPath) || isScriptPath(file.path)) {
        void ChatStorage.getInstance().handleNoteRename(oldPath, file.path)
        return
      }
      if (file.extension !== 'md') return
      // The lists folded under it stay folded, and as far down and as open as they were.
      moveFooterFolds(oldPath, file.path)
      moveFooterView(oldPath, file.path)
      // Keep binding rewrites behind existing maintenance of the same chat records.
      void Promise.all([
        CommentService.getInstance().handleRename(oldPath, file.path),
        ChatStorage.getInstance().handleNoteRename(oldPath, file.path),
      ])
        .then(() => followChatBindingRename(oldPath, file.path))
        .catch((error) => {
          new Notice(
            'Could not follow a card rename in chat links. Reopen the source before changing links.'
          )
          console.error('[Abele] Card link rename failed', error)
        })
    })
  )

  // A comment file arriving or leaving from outside `CommentService` itself — sync, a
  // restore, or a person deleting one by hand — rather than through `create`/`remove`.
  plugin.registerEvent(
    plugin.app.vault.on('create', (file) => {
      if (!(file instanceof TFile) || file.extension !== 'abchat') return
      const comments = CommentService.getInstance()
      if (!comments.isCommentFile(file)) return
      comments.handleFileCreated(file.basename)
    })
  )

  plugin.registerEvent(
    plugin.app.vault.on('delete', (file) => {
      if (!(file instanceof TFile) || file.extension !== 'abchat') return
      const comments = CommentService.getInstance()
      // Every deletion is exact-path scoped, including an undiscovered outside-folder copy.
      comments.handleFileDeleted(file.path)
    })
  )

  // A chat file changing without plugin device changing it — sync landing while the app is
  // open. What it may have brought is the record of a note that chat wrote to, and that
  // record is what a footer under the note draws its card from. A file a session here has
  // open is skipped: that one writes its own entry as it goes, and re-reading it would be a
  // read of the whole conversation on every save.
  plugin.registerEvent(
    plugin.app.vault.on('modify', (file) => {
      if (!(file instanceof TFile) || file.extension !== 'abchat') return
      if (ChatService.getInstance().getSessionByFile(file.path)) return
      void ChatStorage.getInstance().refreshEntry(file)
    })
  )

  // The same question at startup, which is where most of it is answered: the index is plugin
  // device's own cache (`chat-index.json`), so every chat another device wrote is behind.
  plugin.app.workspace.onLayoutReady(() => {
    void ChatStorage.getInstance().refreshHistory()
  })

  plugin.addCommand({
    id: 'show-ai-sidebar',
    name: 'Show AI chat sidebar',
    icon: 'bot',
    // Through the chat service rather than `activateView`: a blank chat shown plugin way gets
    // the cursor, and only the service knows whether the chat in front is blank.
    callback: () => {
      void ChatService.getInstance().revealSidebar()
    },
  })

  // Finding words: in the chat in front, and in every chat there has been. Both show the chat
  // panel first; the chat on screen takes the request (`AiChat.vue`).
  plugin.addCommand({
    id: 'find-in-chat',
    name: 'Find in the current chat',
    icon: 'search',
    callback: () => {
      const chats = ChatService.getInstance()
      void chats.revealSidebar({ focus: false }).then(() => (chats.findRequest.value = true))
    },
  })

  plugin.addCommand({
    id: 'search-all-chats',
    name: 'Search all chats',
    icon: 'history',
    callback: () => {
      const chats = ChatService.getInstance()
      void chats.revealSidebar({ focus: false }).then(() => (chats.historyRequest.value = true))
    },
  })

  // The chat's tab keys as commands too, with no hotkey of their own: the keys work inside the
  // chat by themselves (`chatTabKeys.ts`), and a command is what can be given a key of one's
  // choosing that works from anywhere.
  plugin.addCommand({
    id: 'chat-close-tab',
    name: 'Close the current chat tab',
    callback: () => runChatTabAction('close'),
  })
  plugin.addCommand({
    id: 'chat-reopen-tab',
    name: 'Reopen the last closed chat tab',
    callback: () => runChatTabAction('reopen'),
  })
  plugin.addCommand({
    id: 'chat-next-tab',
    name: 'Go to the next chat tab',
    callback: () => runChatTabAction('next'),
  })
  plugin.addCommand({
    id: 'chat-previous-tab',
    name: 'Go to the previous chat tab',
    callback: () => runChatTabAction('previous'),
  })

  plugin.addRibbonIcon(AiSidebarView.getIcon(), 'Show AI chat', () => {
    void ChatService.getInstance().revealSidebar()
  })

  // Registered whether or not scripts are enabled: the reference is what someone reads
  // while deciding to turn them on.
  plugin.addCommand({
    id: 'voice-input',
    name: 'Dictate into the note',
    icon: 'mic',
    editorCallback: (editor) => {
      void dictate(plugin.app).then((text) => {
        if (!text) return
        // At the cursor, and the cursor after it: dictating twice in a row should append
        // rather than overwrite what the first go put there.
        editor.replaceSelection(text)
        editor.focus()
      })
    },
  })

  plugin.addCommand({
    id: 'show-script-runs',
    name: 'Show script runs',
    icon: ScriptRunsView.getIcon(),
    callback: () => {
      void plugin.activateView(SCRIPT_RUNS_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'open-documentation',
    name: 'Open documentation',
    icon: UserDocsView.getIcon(),
    callback: () => void openUserDocs(plugin.app),
  })

  // The quick button's menu without the button: bound to a key, or from the palette.
  plugin.addCommand({
    id: 'open-quick-menu',
    name: 'Open quick menu',
    icon: 'zap',
    callback: () =>
      void openQuickMenu(plugin.app, {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }),
  })
  // Over the workspace, so only once there is one to be over.
  plugin.app.workspace.onLayoutReady(() => applyQuickButton())

  // Command buttons among the icons at the top right of a note; see `headerButtons/viewActions.ts`.
  plugin.app.workspace.onLayoutReady(() => {
    const commands = new HeaderCommands()
    setHeaderCommands(commands)
    commands.start(plugin)
  })

  // The first start in a vault: no settings file yet. The documentation is the way in, and it
  // is shown once — the settings are written straight after, so the next start is not a first.
  if (AbeleConfig.getInstance().freshInstall) {
    plugin.app.workspace.onLayoutReady(() => {
      void openUserDocs(plugin.app)
      void AbeleConfig.getInstance().saveSettings()
    })
  }

  plugin.addCommand({
    id: 'show-script-api',
    name: 'Show script API reference',
    icon: 'book-open',
    callback: () => {
      // No title: the reference opens with its own heading, which the modal lifts into the
      // title bar rather than showing a second name above it. The views reference follows
      // the main one — a person asking for the API wants all of it, not a second command.
      void showMarkdown(SCRIPT_API_DOCS + '\n\n---\n\n' + SCRIPT_VIEW_DOCS)
    },
  })
}
