import { t } from '@/i18n'
import { TIMELINE_SIDEBAR_VIEW_TYPE, TimelineSidebarView } from '@/views/TimelineSidebarView'
import { TODO_SIDEBAR_VIEW_TYPE, TodoSidebarView } from '@/views/TodoSidebarView'
import { AI_SIDEBAR_VIEW_TYPE, AiSidebarView } from '@/views/AiSidebarView'
import { FINANCE_SIDEBAR_VIEW_TYPE, FinanceSidebarView } from '@/views/FinanceSidebarView'
import { ACCOUNTS_SIDEBAR_VIEW_TYPE, AccountsSidebarView } from '@/views/AccountsSidebarView'
import {
  TIME_TRACKING_SIDEBAR_VIEW_TYPE,
  TimeTrackingSidebarView,
} from '@/views/TimeTrackingSidebarView'
import { SCRIPT_RUNS_VIEW_TYPE, ScriptRunsView } from '@/views/ScriptRunsView'
import { USER_DOCS_VIEW_TYPE, UserDocsView } from '@/views/UserDocsView'
import { SCRIPT_VIEW_TYPE, ScriptView } from '@/views/ScriptView'
import { CODE_VIEW_TYPE, CodeView } from '@/views/CodeView'
import { ScriptViewService } from '@/scripting/view/ScriptViewService'
import { openChat, openSelectionLink } from '@/ai/openChat'
import { keepChatFilesOutOfLeaves, routeChatAnchorLinks } from '@/ai/chatFileLeaves'
import type { Plugin } from 'obsidian'
import { registerDebugger, DEBUG_VIEW_TYPE } from '@/debugger/register'
import { registerRequests } from '@/requests/views'
import { REQUEST_TAB_VIEW } from '@/requests/actions'
import { TRACE_RUN_VIEW } from '@/debugger/trace/TraceTabs'
import { NodeSidebarView } from '@/views/NodeSidebarView'
import { revealSidebarView, loadDeferredSidebarViews } from '@/views/revealSidebarView'
import { NodePathMainView } from '@/views/NodePathMainView'
import { NodePathService } from '@/node/NodePathService'
import { createNodePathObsidianActions } from '@/node/NodePathObsidianActions'
import { installNodePathOwnerActions } from '@/node/NodePathOwnerActions'
import {
  NODE_SIDEBAR_VIEW,
  NODE_FILE_VIEW,
  NODE_HISTORY_VIEW,
  NODE_CHAT_VIEW,
  NODE_EDITOR_VIEW,
} from '@/node/nodePathNavigation'

/** Startup section; called at its original lifecycle position. */
export function registerViews(plugin: Plugin) {
  registerDebugger(plugin)
  registerRequests(plugin)
  plugin.registerView(NODE_SIDEBAR_VIEW, (leaf) => new NodeSidebarView(leaf))
  for (const type of [NODE_FILE_VIEW, NODE_HISTORY_VIEW, NODE_CHAT_VIEW, NODE_EDITOR_VIEW])
    plugin.registerView(type, (leaf) => new NodePathMainView(leaf, type))
  const openNode = async () => {
    const leaf =
      plugin.app.workspace.getLeavesOfType(NODE_SIDEBAR_VIEW)[0] ??
      plugin.app.workspace.getLeftLeaf(false)
    if (!leaf) return
    await leaf.setViewState({
      type: NODE_SIDEBAR_VIEW,
      active: true,
      state: leaf.getViewState().type === NODE_SIDEBAR_VIEW ? leaf.getViewState().state : {},
    })
    await revealSidebarView(plugin.app, NODE_SIDEBAR_VIEW)
  }
  plugin.addCommand({
    id: 'open-node',
    name: t('commands.open-node'),
    callback: () => {
      void openNode()
    },
  })
  plugin.addRibbonIcon('server', t('ribbon.node'), () => {
    void openNode()
  })
  plugin.register(() => NodePathService.destroyCurrent())
  const chatActions = createNodePathObsidianActions()
  if (chatActions) plugin.register(installNodePathOwnerActions(chatActions))
  plugin.registerView(
    TIMELINE_SIDEBAR_VIEW_TYPE,
    (leaf) => new TimelineSidebarView(leaf, plugin.app)
  )
  plugin.app.workspace.onLayoutReady(() => {
    void loadDeferredSidebarViews(
      plugin.app.workspace,
      [TIMELINE_SIDEBAR_VIEW_TYPE, DEBUG_VIEW_TYPE, TRACE_RUN_VIEW, REQUEST_TAB_VIEW],
      true
    )
  })
  plugin.registerView(TODO_SIDEBAR_VIEW_TYPE, (leaf) => new TodoSidebarView(leaf, plugin.app))
  plugin.registerView(FINANCE_SIDEBAR_VIEW_TYPE, (leaf) => new FinanceSidebarView(leaf, plugin.app))
  plugin.registerView(
    ACCOUNTS_SIDEBAR_VIEW_TYPE,
    (leaf) => new AccountsSidebarView(leaf, plugin.app)
  )
  plugin.registerView(SCRIPT_RUNS_VIEW_TYPE, (leaf) => new ScriptRunsView(leaf, plugin.app))
  plugin.registerView(SCRIPT_VIEW_TYPE, (leaf) => new ScriptView(leaf))
  // Reader dashboards, live slides and restored tabs also execute scripts directly.
  // The leaf host belongs to the registered view type, not to the optional script index.
  ScriptViewService.getInstance()
  plugin.registerView(
    TIME_TRACKING_SIDEBAR_VIEW_TYPE,
    (leaf) => new TimeTrackingSidebarView(leaf, plugin.app)
  )

  plugin.registerView(CODE_VIEW_TYPE, (leaf) => new CodeView(leaf))
  // The documentation for people, opened by a command, from the settings and on first start.
  plugin.registerView(USER_DOCS_VIEW_TYPE, (leaf) => new UserDocsView(leaf))
  plugin.registerExtensions(
    ['json', 'css', 'js', 'ts', 'html', 'xml', 'yaml', 'yml', 'csv', 'txt', 'abchat', 'abcomment'],
    CODE_VIEW_TYPE
  )
  // A chat file opened from anywhere — file explorer, quick switcher, a link, search — goes
  // to the chat panel instead of replacing the note in front.
  plugin.register(keepChatFilesOutOfLeaves(openChat, () => plugin.app.workspace))
  plugin.register(routeChatAnchorLinks(plugin.app.workspace, openSelectionLink))

  // AI sidebar is always registered so the view can be restored, but commands/ribbon are conditional
  plugin.registerView(AI_SIDEBAR_VIEW_TYPE, (leaf) => new AiSidebarView(leaf, plugin.app))
}
