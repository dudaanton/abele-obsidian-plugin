import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { EDIT_SELECTION_TOOL } from '../types'
import { createReadFileTool } from './ReadFileTool'
import { READ_BUDGET, READ_RESULT, READ_RESULT_DESCRIPTION } from '../resultStore'
import { isDefaultDescription } from './toolDescriptionOverrides'
import { EDIT_SELECTION_DESCRIPTION } from './EditSelectionTool'
import { createLsTool } from './LsTool'
import { createFindTool } from './FindTool'
import { createEditFileTool } from './EditFileTool'
import { createCreateFileTool } from './CreateFileTool'
import { createDeleteFileTool } from './DeleteFileTool'
import { createMoveFileTool } from './MoveFileTool'
import { createCopyFileTool } from './CopyFileTool'
import { createListWorkspaceTool } from './ListWorkspaceTool'
import { createWebSearchTool } from './WebSearchTool'
import { createReadImageTool } from './ReadImageTool'
import { createFetchTool } from './FetchTool'
import { createSkillTool } from './SkillTool'
import { createGenerateImageTool } from './GenerateImageTool'
import { createEditImageTool } from './EditImageTool'
import { createEvalJsTool } from './EvalJsTool'
import { createListTemplatesTool, createApplyTemplateTool } from './TemplateTool'
import { createDownloadImageTool, createDownloadFileTool } from './DownloadImageTool'
import { createDelegateTool } from './DelegateTool'
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
import { createTemplateDocsTool } from './TemplateDocsTool'
import { createQueryDocsTool } from './QueryDocsTool'
import { createReadSettingsTool, createWriteSettingsTool } from './SettingsTools'
import { createRememberTool } from './RememberTool'
import { createForgetTool } from './ForgetTool'
import { createGithubTools } from './github'
import { createBookTools } from './BookTools'
import { githubSettings } from '@/github/GithubService'
import { createMcpTools } from '../mcp/tools'
import { AgentRegistry } from '../agents/AgentRegistry'
import { ChatSession } from '../ChatSession'
import {
  createReadLogsTool,
  createReadBacklinksTool,
  createReadTransactionsTool,
  createReadTasksTool,
} from './RelationTools'

export interface ToolInfo {
  name: string
  label: string
  category: string
  /** What the tool says of itself: the default the settings screen shows and edits from. */
  description: string
}

/** Get metadata for all registered tools (for UI display) */
export function getToolRegistry(): ToolInfo[] {
  const tools = buildAgentTools()
  const labels: Record<string, string> = {}
  for (const t of tools) labels[t.name] = t.label

  const CATEGORY_ORDER = [
    'Files',
    'Network',
    'GitHub',
    'Books',
    'AI',
    'Vault data',
    'Maps',
    'Docs',
    'Templates',
    'Scripts',
    'Settings',
  ]

  const TOOL_CATEGORIES: Record<string, { label: string; category: string }> = {
    read: { label: 'Read file', category: 'Files' },
    edit: { label: 'Edit file', category: 'Files' },
    replace: { label: 'Replace', category: 'Files' },
    write: { label: 'Write file', category: 'Files' },
    create: { label: 'Create file', category: 'Files' },
    rm: { label: 'Delete file', category: 'Files' },
    mv: { label: 'Move file', category: 'Files' },
    cp: { label: 'Copy file', category: 'Files' },
    ls: { label: 'List directory', category: 'Files' },
    find: { label: 'Find files', category: 'Files' },
    workspace: { label: 'Workspace', category: 'Files' },
    read_image: { label: 'Read image', category: 'Files' },
    open: { label: 'Open file', category: 'Files' },
    screenshot: { label: 'Screenshot', category: 'Files' },
    inspect_view: { label: 'Inspect view', category: 'Files' },
    web_search: { label: 'Web search', category: 'Network' },
    fetch: { label: 'Fetch URL', category: 'Network' },
    download_image: { label: 'Download image', category: 'Network' },
    download_file: { label: 'Download file', category: 'Network' },
    github_views: { label: 'GitHub tabs', category: 'GitHub' },
    github_read: { label: 'Read issue or PR', category: 'GitHub' },
    github_pr_files: { label: 'PR files', category: 'GitHub' },
    github_file: { label: 'Read file', category: 'GitHub' },
    github_commits: { label: 'Commits', category: 'GitHub' },
    github_search: { label: 'Search', category: 'GitHub' },
    github_grep: { label: 'Grep code at a version', category: 'GitHub' },
    github_open: { label: 'Show in a tab', category: 'GitHub' },
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
    geocode: { label: 'Geocode', category: 'Maps' },
    places: { label: 'Find places', category: 'Maps' },
    route: { label: 'Build route', category: 'Maps' },
    generate_image: { label: 'Generate image', category: 'AI' },
    edit_image: { label: 'Edit image', category: 'AI' },
    eval_js: { label: 'Eval JS', category: 'AI' },
    questions: { label: 'Questions', category: 'AI' },
    delegate: { label: 'Delegate', category: 'AI' },
    remember: { label: 'Remember', category: 'AI' },
    forget: { label: 'Forget', category: 'AI' },
    chart_docs: { label: 'Chart docs', category: 'Docs' },
    template_docs: { label: 'Template docs', category: 'Docs' },
    read_logs: { label: 'Read logs', category: 'Vault data' },
    read_backlinks: { label: 'Read backlinks', category: 'Vault data' },
    read_transactions: { label: 'Read transactions', category: 'Vault data' },
    read_tasks: { label: 'Read tasks', category: 'Vault data' },
    list_templates: { label: 'List templates', category: 'Templates' },
    apply_template: { label: 'Apply template', category: 'Templates' },
    skill: { label: 'Skill', category: 'Templates' },
    script_api_docs: { label: 'Script API docs', category: 'Docs' },
    query_docs: { label: 'Query docs', category: 'Docs' },
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
    result.push({
      name: t.name,
      label: info?.label || labels[t.name] || t.name,
      category:
        info?.category || t.category || (t.name.startsWith('script_') ? 'Scripts' : 'Other'),
      description: t.description,
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

export interface AgentToolsOptions {
  /**
   * The agent the tools act for — whose memory `remember` and `forget` change. A chat passes its own, a script
   * the agent it runs. Without one, the session executing the call is asked; never the chat
   * that happens to be open, which may be on a different agent entirely.
   */
  agentId?: string
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
  }
  for (const tool of tools) out[tool.name] = tool.description
  return out
}

/** The tools with their own descriptions. `everything` adds the ones behind a switch. */
function buildAgentTools(options: AgentToolsOptions = {}, everything = false): AgentTool[] {
  const resolveAgent = () =>
    options.agentId
      ? AgentRegistry.getInstance().get(options.agentId)
      : (ChatSession.getActiveSession()?.agent.value ?? null)

  const tools = [
    createReadFileTool({ numbered: true, budget: READ_BUDGET }),
    createLsTool(),
    createFindTool({ compact: true }),
    createEditFileTool(),
    createCreateFileTool(),
    createDeleteFileTool(),
    createMoveFileTool(),
    createCopyFileTool(),
    createListWorkspaceTool(),
    createWebSearchTool(),
    createReadImageTool(),
    createFetchTool(),
    createSkillTool(),
    createGenerateImageTool(),
    createEditImageTool(),
    createEvalJsTool(),
    createListTemplatesTool(),
    createApplyTemplateTool(),
    createDownloadImageTool(),
    createDownloadFileTool(),
    createDelegateTool(),
    createReplaceTool(),
    createWriteFileTool(),
    createOpenFileTool(),
    createQuestionsTool(),
    createChartDocsTool(),
    createQueryDocsTool(),
    createReadSettingsTool(),
    createWriteSettingsTool(),
    createTemplateDocsTool(),
    createReadLogsTool(),
    createReadBacklinksTool(),
    createReadTransactionsTool(),
    createReadTasksTool(),
    createScreenshotTool(),
    createInspectViewTool(),
    createGeocodeTool(),
    createPlacesTool(),
    createRouteTool(),
    createRememberTool(resolveAgent),
    createForgetTool(resolveAgent),
  ]

  // Books and PDFs in the vault, as far as the chat's scope reaches: read, and marked — highlights
  // and bookmarks, written where the reader writes them. The book files are never changed.
  tools.push(...createBookTools())

  // Read-only, and only while the integration is on: with it off there is no GitHub to read.
  if (everything || githubSettings().enabled) tools.push(...createGithubTools())

  const config = AbeleConfig.getInstance().ai

  // Each server's tools as the person last fetched them; which agent gets them is its modes.
  tools.push(...createMcpTools(config.mcpServers))

  if (everything || config.scriptsEnabled) {
    if (!everything) tools.push(...createScriptTools())
    tools.push(createAnswerFormTool())
    tools.push(createScriptApiDocsTool())
    tools.push(createCreateScriptTool())
  }

  return tools
}
