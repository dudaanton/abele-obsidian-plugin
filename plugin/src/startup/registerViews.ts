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

/** Startup section; called at its original lifecycle position. */
export function registerViews(plugin: Plugin) {
  plugin.registerView(
    TIMELINE_SIDEBAR_VIEW_TYPE,
    (leaf) => new TimelineSidebarView(leaf, plugin.app)
  )
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
