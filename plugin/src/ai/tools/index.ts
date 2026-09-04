import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { EDIT_SELECTION_TOOL } from '../types'
import { createReadFileTool } from './ReadFileTool'
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
import { createScriptTools } from './ScriptTool'
import { createCreateScriptTool, createScriptApiDocsTool } from './CreateScriptTool'
import { createReplaceTool } from './ReplaceTool'
import { createWriteFileTool } from './WriteFileTool'
import { createOpenFileTool } from './OpenFileTool'
import { createQuestionsTool } from './QuestionsTool'
import { createScreenshotTool } from './ScreenshotTool'
import { createInspectViewTool } from './InspectViewTool'
import { createChartDocsTool } from './ChartDocsTool'
import { createTemplateDocsTool } from './TemplateDocsTool'
import { createQueryDocsTool } from './QueryDocsTool'
import { createReadSettingsTool, createWriteSettingsTool } from './SettingsTools'
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
}

/** Get metadata for all registered tools (for UI display) */
export function getToolRegistry(): ToolInfo[] {
  const tools = createAgentTools()
  const labels: Record<string, string> = {}
  for (const t of tools) labels[t.name] = t.label

  const CATEGORY_ORDER = [
    'Files',
    'Network',
    'AI',
    'Vault data',
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
    generate_image: { label: 'Generate image', category: 'AI' },
    edit_image: { label: 'Edit image', category: 'AI' },
    eval_js: { label: 'Eval JS', category: 'AI' },
    questions: { label: 'Questions', category: 'AI' },
    delegate: { label: 'Delegate', category: 'AI' },
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
      category: info?.category || (t.name.startsWith('script_') ? 'Scripts' : 'Other'),
    })
  }

  // Session-scoped, so it is not in `createAgentTools()` — but the agent editor still has to
  // offer its mode, and the Comment agent ships with one set.
  result.push({ name: EDIT_SELECTION_TOOL, label: 'Edit selection', category: 'Files' })

  result.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category)
    const bi = CATEGORY_ORDER.indexOf(b.category)
    const ca = ai === -1 ? 999 : ai
    const cb = bi === -1 ? 999 : bi
    if (ca !== cb) return ca - cb
    return a.label.localeCompare(b.label)
  })

  return result
}

export function createAgentTools(): AgentTool[] {
  const tools = [
    createReadFileTool(),
    createLsTool(),
    createFindTool(),
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
  ]

  const config = AbeleConfig.getInstance().ai
  if (config.scriptsEnabled) {
    tools.push(...createScriptTools())
    tools.push(createScriptApiDocsTool())
    tools.push(createCreateScriptTool())
  }

  const customDescriptions = AbeleConfig.getInstance().ai.prompts?.toolDescriptions
  if (customDescriptions) {
    for (const tool of tools) {
      if (customDescriptions[tool.name]) {
        tool.description = customDescriptions[tool.name]
      }
    }
  }

  return tools
}
