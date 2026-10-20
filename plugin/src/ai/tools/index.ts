import { createAnalyticsTools } from './AnalyticsTools'
import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { EDIT_SELECTION_TOOL } from '../types'
import {
  GROUP_ORDER,
  TOOL_SECTIONS,
  sectionToolDescriptions,
  sectionToolName,
  sectionLabel,
} from '../toolSections'
import { createReadFileTool } from './ReadFileTool'
import { READ_BUDGET, READ_RESULT, READ_RESULT_DESCRIPTION } from '../resultStore'
import { isDefaultDescription } from './toolDescriptionOverrides'
import { EDIT_SELECTION_DESCRIPTION } from './EditSelectionTool'
import { createLsTool } from './LsTool'
import { createFindTool } from './FindTool'
import { createEditFileTool } from './EditFileTool'
import { createCreateFileTool } from './CreateFileTool'
import { createZipTool } from './ZipTool'
import { createDeleteFileTool } from './DeleteFileTool'
import { createMoveFileTool } from './MoveFileTool'
import { createCopyFileTool } from './CopyFileTool'
import { createListWorkspaceTool } from './ListWorkspaceTool'
import { createWebSearchTool } from './WebSearchTool'
import { createReadImageTool } from './ReadImageTool'
import { createLookAtDrawingTool } from './DrawingTool'
import { createCanvasTools } from './CanvasTools'
import { createFetchTool } from './FetchTool'
import { createSkillTool } from './SkillTool'
import { createGenerateImageTool } from './GenerateImageTool'
import { createEditImageTool } from './EditImageTool'
import { createEvalJsTool } from './EvalJsTool'
import { createListTemplatesTool, createApplyTemplateTool } from './TemplateTool'
import { createDownloadImageTool, createDownloadFileTool } from './DownloadImageTool'
import { createDelegateTool } from './DelegateTool'
import { createNodeManagerTools } from './NodeManagerTools'
import { createNodeDelegationTools } from './NodeDelegationTools'
import { createScriptTools, createAnswerFormTool } from './ScriptTool'
import { createCreateScriptTool, createScriptApiDocsTool } from './CreateScriptTool'
import { createReplaceTool } from './ReplaceTool'
import { createWriteFileTool } from './WriteFileTool'
import { createOpenFileTool } from './OpenFileTool'
import { createQuestionsTool } from './QuestionsTool'
import { createScreenshotTool } from './ScreenshotTool'
import { createInspectViewTool } from './InspectViewTool'
import { createChartDocsTool } from './ChartDocsTool'
import { createGeocodeTool, createPlacesTool, createRouteTool } from './GeoTools'
import { createCurrentLocationTool } from './CurrentLocationTool'
import { createTemplateDocsTool } from './TemplateDocsTool'
import { createQueryDocsTool } from './QueryDocsTool'
import { createReadSettingsTool, createWriteSettingsTool } from './SettingsTools'
import { createRememberTool } from './RememberTool'
import { createForgetTool } from './ForgetTool'
import { createGithubTools, createForgeTools } from './github'
import { createNodeTools } from './node'
import { createTraceTools } from './TraceTools'
import { activeTraceContext } from '@/debugger/trace/agentContext'
import { createRequestTools } from './RequestTools'
import { activeRequestsContext } from '@/requests/agentContext'
import { createBookTools } from './BookTools'
import { createDeckTools } from './DeckTools'
import { createDocxTools } from './DocxTools'
import { createXlsxTools } from './XlsxTools'
import { createLintTool, createLintFixTool } from './LintTools'
import { githubSettings } from '@/github/GithubService'
import { createMcpTools } from '../mcp/tools'
import { AgentRegistry } from '../agents/AgentRegistry'
import type { ToolContext } from '../toolContext'
import type { ChatSession } from '../ChatSession'
import type { ScopeResolver } from '../ScopeResolver'
import {
  createReadLogsTool,
  createReadBacklinksTool,
  createReadTransactionsTool,
  createReadTasksTool,
} from './RelationTools'

export interface ToolInfo {
  name: string
  permissionKey?: string
  label: string
  category: string
  /** What the tool says of itself: the default the settings screen shows and edits from. */
  description: string
}

/** Get metadata for all registered tools (for UI display) */
export function getToolRegistry(tools: AgentTool[] = buildAgentTools()): ToolInfo[] {
  const labels: Record<string, string> = {}
  for (const t of tools) labels[t.name] = t.label

  const CATEGORY_ORDER = GROUP_ORDER

  const TOOL_CATEGORIES: Record<string, { label: string; category: string }> = {
    read: { label: 'Read file', category: 'Files' },
    edit: { label: 'Edit file', category: 'Files' },
    replace: { label: 'Replace', category: 'Files' },
    write: { label: 'Write file', category: 'Files' },
    create: { label: 'Create file', category: 'Files' },
    zip: { label: 'Create ZIP', category: 'Files' },
    rm: { label: 'Delete file', category: 'Files' },
    mv: { label: 'Move file', category: 'Files' },
    cp: { label: 'Copy file', category: 'Files' },
    ls: { label: 'List directory', category: 'Files' },
    find: { label: 'Find files', category: 'Files' },
    workspace: { label: 'Workspace', category: 'Files' },
    read_image: { label: 'Read image', category: 'Files' },
    look_at_drawing: { label: 'Look at drawing', category: 'Files' },
    open: { label: 'Open file', category: 'App view' },
    screenshot: { label: 'Screenshot', category: 'App view' },
    inspect_view: { label: 'Inspect view', category: 'App view' },
    web_search: { label: 'Web search', category: 'Web' },
    fetch: { label: 'Fetch URL', category: 'Web' },
    download_image: { label: 'Download image', category: 'Web' },
    download_file: { label: 'Download file', category: 'Web' },
    github_views: { label: 'GitHub tabs', category: 'GitHub' },
    github_read: { label: 'Read issue or PR', category: 'GitHub' },
    github_pr_files: { label: 'PR files', category: 'GitHub' },
    github_file: { label: 'Read file', category: 'GitHub' },
    github_commits: { label: 'Commits', category: 'GitHub' },
    github_search: { label: 'Search', category: 'GitHub' },
    github_grep: { label: 'Grep code at a version', category: 'GitHub' },
    github_open: { label: 'Show in a tab', category: 'GitHub' },
    forge_views: { label: 'Repository tabs', category: 'Git repositories' },
    forge_read: { label: 'Read issue or PR', category: 'Git repositories' },
    forge_pr_files: { label: 'PR files', category: 'Git repositories' },
    forge_file: { label: 'Read file', category: 'Git repositories' },
    forge_commits: { label: 'Commits', category: 'Git repositories' },
    forge_search: { label: 'Search', category: 'Git repositories' },
    forge_grep: { label: 'Grep code at a version', category: 'Git repositories' },
    forge_open: { label: 'Show in a tab', category: 'Git repositories' },
    book_views: { label: 'Book tabs', category: 'Books' },
    book_contents: { label: 'Book contents', category: 'Books' },
    book_read: { label: 'Read book', category: 'Books' },
    book_search: { label: 'Search book', category: 'Books' },
    book_open: { label: 'Show in a book', category: 'Books' },
    book_list: { label: 'List books', category: 'Books' },
    book_highlights: { label: 'Book highlights', category: 'Books' },
    book_highlight: { label: 'Highlight in a book', category: 'Books' },
    book_highlight_edit: { label: 'Change a highlight', category: 'Books' },
    book_highlight_remove: { label: 'Remove a highlight', category: 'Books' },
    book_bookmark: { label: 'Bookmark in a book', category: 'Books' },
    current_location: { label: 'Current location', category: 'Maps' },
    geocode: { label: 'Geocode', category: 'Maps' },
    places: { label: 'Find places', category: 'Maps' },
    route: { label: 'Build route', category: 'Maps' },
    generate_image: { label: 'Generate image', category: 'Images' },
    edit_image: { label: 'Edit image', category: 'Images' },
    eval_js: { label: 'Eval JS', category: 'App view' },
    questions: { label: 'Questions', category: 'Basics' },
    delegate: { label: 'Delegate', category: 'Delegation' },
    remember: { label: 'Remember', category: 'Memory' },
    forget: { label: 'Forget', category: 'Memory' },
    chart_docs: { label: 'Chart docs', category: 'Docs' },
    template_docs: { label: 'Template docs', category: 'Docs' },
    read_logs: { label: 'Read logs', category: 'Notes data' },
    read_backlinks: { label: 'Read backlinks', category: 'Notes data' },
    read_transactions: { label: 'Read transactions', category: 'Finance' },
    read_tasks: { label: 'Read tasks', category: 'Tasks' },
    read_data: { label: 'Read data', category: 'Notes data' },
    analyze_data: { label: 'Analyze data', category: 'Notes data' },
    lint: { label: 'Lint notes', category: 'Notes data' },
    lint_fix: { label: 'Fix lint issues', category: 'Notes data' },
    list_templates: { label: 'List templates', category: 'Templates' },
    apply_template: { label: 'Apply template', category: 'Templates' },
    skill: { label: 'Skill', category: 'Basics' },
    script_api_docs: { label: 'Script API docs', category: 'Docs' },
    query_docs: { label: 'Query docs', category: 'Basics' },
    read_settings: { label: 'Read settings', category: 'Settings' },
    write_settings: { label: 'Write settings', category: 'Settings' },
    create_script: { label: 'Create script', category: 'Scripts' },
    answer_form: { label: 'Answer form', category: 'Scripts' },
  }

  const result: ToolInfo[] = []
  const seen = new Set<string>()

  for (const t of tools) {
    if (seen.has(t.name)) continue
    seen.add(t.name)
    const info = TOOL_CATEGORIES[t.name]
    const own = info?.category || t.category
    result.push({
      name: t.name,
      permissionKey: t.permissionKey,
      label: info?.label || labels[t.name] || t.name,
      // Every node tool is one group, whatever the tool calls its own: files, repositories and
      // agents on a node are one thing to the person and one section to the agent.
      category: isNodeTool(t.name, own)
        ? 'Nodes'
        : own || (t.name.startsWith('script_') ? 'Scripts' : 'Other'),
      get description() {
        return t.description
      },
    })
  }

  // Session-scoped, so it is not in `createAgentTools()` — but the agent editor still has to
  // offer its mode, and the Comment agent ships with one set.
  result.push({
    name: EDIT_SELECTION_TOOL,
    label: 'Edit selection',
    category: 'Files',
    description: EDIT_SELECTION_DESCRIPTION,
  })
  // Bound to the conversation's store of long results, so made by the session, not here.
  result.push({
    name: READ_RESULT,
    label: 'Read result',
    category: 'Files',
    description: READ_RESULT_DESCRIPTION,
  })

  result.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category)
    const bi = CATEGORY_ORDER.indexOf(b.category)
    const ca = ai === -1 ? 999 : ai
    const cb = bi === -1 ? 999 : bi
    if (ca !== cb) return ca - cb
    // Groups the list does not know — one per MCP server — stay whole, in the order of their names.
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.label.localeCompare(b.label)
  })

  return result
}

const NODE_GROUPS = new Set(['Node files', 'Node repositories', 'Nodes'])
const isNodeTool = (name: string, category: string | undefined) =>
  NODE_GROUPS.has(category ?? '') || name.startsWith('node_') || name === 'list_node_worktrees'

/**
 * The section tools of the groups the plugin defines, for the settings screen that edits tool
 * descriptions. They have no mode: opening a section grants nothing.
 */
export function getSectionToolRegistry(): ToolInfo[] {
  return TOOL_SECTIONS.map((section) => ({
    name: sectionToolName(section.id),
    label: `Open ${sectionLabel(section.group)}`,
    category: section.group,
    description: section.description,
  }))
}

export interface AgentToolsOptions {
  /** The invocation's owner, never whichever tab happens to be in front. */
  session?: ChatSession
  /** Only an interactive executing session may ask for per-connection GitHub access. */
  githubApproval?: import('@/github/agentAccess').ConnectionApproval
  nodeRepositoryApproval?: import('./node').RepositoryReadApproval
  /**
   * The agent the tools act for — whose memory `remember` and `forget` change. A chat passes its own, a script
   * the agent it runs. Without one, the call context identifies the agent; never the chat
   * that happens to be open, which may be on a different agent entirely.
   */
  agentId?: string
  scope?: ScopeResolver
  skillCeiling?: ReadonlySet<string>
  githubAgent?: () => import('../agents/types').AgentDefinition | null
}

/**
 * The tools an agent is handed: each described by the person's override where there is one,
 * and by itself otherwise. The settings hold overrides only (see `toolDescriptionOverrides`);
 * a saved copy of a default that slipped through is still not taken for one.
 */
export function createAgentTools(options: AgentToolsOptions = {}): AgentTool[] {
  const tools = buildAgentTools(options)
  const overrides = AbeleConfig.getInstance().ai.prompts?.toolDescriptions ?? {}
  for (const tool of tools) {
    const saved = overrides[tool.name]
    if (saved && !isDefaultDescription(tool.name, saved, tool.description)) {
      tool.description = saved
    }
  }
  return tools
}

/**
 * What every tool says of itself, whatever is switched on — the defaults a saved description is
 * compared with. A script's own tool is left out: its description is the script's.
 */
export function codeToolDescriptions(): Record<string, string> {
  const tools = buildAgentTools({}, true)
  const out: Record<string, string> = {
    [EDIT_SELECTION_TOOL]: EDIT_SELECTION_DESCRIPTION,
    [READ_RESULT]: READ_RESULT_DESCRIPTION,
    ...sectionToolDescriptions(),
  }
  for (const tool of tools) out[tool.name] = tool.description
  return out
}

/** The tools with their own descriptions. `everything` adds the ones behind a switch. */
function buildAgentTools(options: AgentToolsOptions = {}, everything = false): AgentTool[] {
  const resolveAgent = (ctx?: ToolContext) => {
    const id = options.agentId ?? ctx?.agentId
    return id ? AgentRegistry.getInstance().get(id) : null
  }

  const tools = [
    createReadFileTool({ numbered: true, budget: READ_BUDGET }),
    createLsTool(),
    createFindTool({ compact: true }),
    createEditFileTool(),
    createCreateFileTool(),
    createZipTool(),
    createDeleteFileTool(),
    createMoveFileTool(),
    createCopyFileTool(),
    createListWorkspaceTool(),
    createWebSearchTool(),
    createReadImageTool(),
    createLookAtDrawingTool(),
    createFetchTool(),
    createSkillTool({
      agentId: options.agentId,
      scope: options.scope,
      skillCeiling: options.skillCeiling,
    }),
    createGenerateImageTool(),
    createEditImageTool(),
    createEvalJsTool(),
    createListTemplatesTool(),
    createApplyTemplateTool(),
    createDownloadImageTool(),
    createDownloadFileTool(),
    createDelegateTool(options.session),
    ...createNodeDelegationTools(options.session),
    ...createNodeManagerTools(options.session),
    createReplaceTool(),
    createWriteFileTool(),
    createOpenFileTool(),
    createQuestionsTool(options.session),
    createChartDocsTool(),
    createQueryDocsTool(),
    createReadSettingsTool(),
    createWriteSettingsTool(),
    createTemplateDocsTool(),
    createReadLogsTool(),
    createReadBacklinksTool(),
    createReadTransactionsTool(),
    createReadTasksTool(),
    // Statistics over finance, notes and bases, computed rather than guessed. Read-only.
    ...createAnalyticsTools(),
    createLintTool(),
    createLintFixTool(),
    createScreenshotTool(),
    createInspectViewTool(),
    createCurrentLocationTool(),
    createGeocodeTool(),
    createPlacesTool(),
    createRouteTool(),
    createRememberTool(resolveAgent),
    createForgetTool(resolveAgent),
  ]

  // Books and PDFs in the vault, as far as the chat's scope reaches: read, and marked — highlights
  // and bookmarks, written where the reader writes them. The book files are never changed.
  tools.push(...createBookTools())
  tools.push(...createDeckTools())
  tools.push(...createDocxTools())
  tools.push(...createXlsxTools())
  tools.push(...createCanvasTools())
  tools.push(...createNodeTools(undefined, options.nodeRepositoryApproval))
  // A run the debugger recorded, read a little at a time; each tool's mode decides whether it asks.
  tools.push(...createTraceTools(activeTraceContext))
  tools.push(...createRequestTools(activeRequestsContext))

  // Read-only, and only while the integration is on: with it off there is no GitHub to read.
  if (everything || githubSettings().enabled)
    tools.push(
      ...createGithubTools({
        agent: options.githubAgent ?? resolveAgent,
        approve: options.githubApproval,
      }),
      ...createForgeTools({
        agent: options.githubAgent ?? resolveAgent,
        approve: options.githubApproval,
      })
    )

  // Absent while the settings are being loaded — `codeToolDescriptions` asks then.
  const config = AbeleConfig.getInstance().ai

  // Each server's tools as the person last fetched them; which agent gets them is its modes.
  tools.push(...createMcpTools(config?.mcpServers))

  if (everything || config?.scriptsEnabled) {
    if (!everything) tools.push(...createScriptTools())
    tools.push(createAnswerFormTool())
    tools.push(createScriptApiDocsTool())
    tools.push(createCreateScriptTool())
  }

  return tools
}
