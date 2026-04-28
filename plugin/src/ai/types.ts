export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKeyId: string // reference for Obsidian keychain
  models: AiModelConfig[]
}

export interface AiModelConfig {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  supportsReasoning: boolean
}

export interface AiPrompts {
  system: string
  titleGeneration: string
  titleSystem: string
  compactPrompt: string
  toolDescriptions: Record<string, string>
}

export type PermissionMode = 'confirm-all' | 'allow-edit' | 'allow-all'
export type ToolMode = 'off' | 'ask' | 'auto'

export interface AiChatHistoryEntry {
  path: string
  title: string
  created: string
}

export interface AiSecret {
  name: string
  keyId: string // reference for Obsidian keychain
}

export interface AiSettings {
  enabled: boolean
  providers: AiProvider[]
  activeProviderId: string
  activeModelId: string
  auxiliaryModelId: string
  wiseModelId: string
  delegateModelId: string
  sequentialAuxiliary: boolean
  permissionMode: PermissionMode
  toolModes: Record<string, ToolMode>
  scriptsEnabled: boolean
  scriptsFolder: string
  defaultScope: Array<{ type: 'file' | 'folder' | 'pattern' | 'group'; path: string }>
  defaultFullVaultAccess: boolean
  chatFolder: string
  chatHistory: AiChatHistoryEntry[]
  braveSearchApiKey: string
  openRouterApiKey: string
  imageModel: string
  secrets: AiSecret[]
  prompts: AiPrompts
  systemPromptFromNote: boolean
  systemPromptNotePath: string
}

/** Tools always sent to agent, governed by permissionMode */
export const CORE_TOOLS = new Set([
  'read',
  'edit',
  'replace',
  'create',
  'rm',
  'mv',
  'cp',
  'ls',
  'find',
  'workspace',
  'read_image',
  'skill',
  'list_templates',
  'apply_template',
])

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  providers: [],
  activeProviderId: '',
  activeModelId: '',
  auxiliaryModelId: '',
  wiseModelId: '',
  delegateModelId: '',
  sequentialAuxiliary: false,
  permissionMode: 'confirm-all',
  toolModes: {
    web_search: 'auto',
    chart_docs: 'auto',
    script_api_docs: 'auto',
  },
  scriptsEnabled: false,
  scriptsFolder: '',
  defaultScope: [],
  defaultFullVaultAccess: false,
  chatFolder: 'AI/Chats/{{name}}',
  chatHistory: [],
  braveSearchApiKey: '',
  openRouterApiKey: '',
  imageModel: 'google/gemini-2.5-flash-preview:thinking',
  secrets: [],
  systemPromptFromNote: false,
  systemPromptNotePath: '',
  prompts: {
    system:
      "You are an AI assistant integrated into Obsidian note-taking app through the Abele plugin. You can read, create, edit, delete, and move files in the user's vault. You can also search the web.\n\nWhen working with files, always explain what you're about to do before doing it. Be concise but thorough.",
    titleGeneration:
      'Generate a short title (3-6 words, no quotes) for this conversation:\n\n{{messages}}',
    titleSystem: 'You generate concise chat titles. Reply with ONLY the title, nothing else.',
    compactPrompt:
      'Summarize the conversation below into a concise context summary. Preserve key decisions, file paths, code changes, and any pending tasks. The summary will replace the conversation history, so include everything needed to continue the work.\n\n{{messages}}',
    toolDescriptions: {
      read: 'Read the content of a file. Only files within the current workspace scope are accessible.',
      ls: 'List files and subdirectories in a folder. Only shows items within workspace scope. Use without path to list scope root folders.',
      find: 'Search for files within workspace scope by name pattern, frontmatter property, or content text.',
      edit: 'Edit a file by replacing an exact string match with new content. File must be in workspace scope.',
      create: 'Create a new file in the vault with the specified content.',
      rm: 'Delete a file (moves to trash). File must be in workspace scope.',
      mv: 'Move or rename a file. Source must be in workspace scope.',
      cp: 'Copy a file to a new location. Source must be in workspace scope.',
      workspace:
        'Show all files currently accessible in the workspace scope. Use this to understand what files you can work with.',
      web_search: 'Search the web using Brave Search. Returns titles, URLs, and descriptions.',
      read_image:
        'Load an image so you can see its contents. Images in workspace scope are loaded automatically; others require user approval.',
      fetch:
        'Send an HTTP request to any URL. Supports all methods, custom headers, and request body. Returns status code and response.',
      wise_model:
        'Consult a more powerful AI model for complex analysis, evaluation, or reasoning. Use when the task requires deeper expertise.',
      generate_image:
        'Generate an image from a text prompt. The image is saved to the vault attachments folder. Returns the path of the saved image.',
      edit_image:
        'Edit an existing vault image using a text prompt. Provide the source image path and editing instructions. Returns the path of the edited image.',
      eval_js:
        'Execute JavaScript code in a sandbox for calculations, data processing, or string manipulation. No file/network/DOM access.',
      list_templates:
        'List available note templates. Shows names, types, and required variables. Use before apply_template.',
      apply_template:
        'Create a new note from a template. Provide the template path and values for user variables.',
      download_image:
        'Download an image from a URL and save it to the vault attachments folder. Returns the saved file path.',
      download_file:
        'Download any file from a URL and save it to the vault attachments folder. Returns the saved file path.',
      delegate:
        'Delegate repetitive tasks to sub-agents for parallel processing. Each item gets a fresh context. Use for batch operations on many items.',
      replace:
        'Apply batch replacement actions to a file: set/remove properties, add/remove list items, replace in content or properties, move file. Supports regex.',
      open: 'Open a file in the Obsidian editor.',
      read_logs: 'Read log entries related to a note.',
      read_backlinks: 'Read notes linked to a note through groups (transitive backlinks).',
      read_transactions:
        'Read financial transactions, optionally filtered by note and date period.',
      read_tasks: 'Read tasks, optionally filtered by note, date period, and completion status.',
      chart_docs:
        'Get the reference for creating abele-chart codeblocks with chart types, data formats, and formula syntax.',
      script_api_docs:
        'Get the full API reference for writing Abele scripts. Call before create_script.',
      create_script: 'Create a new JavaScript script in the scripts folder.',
    },
  },
}

/** Migrate old boolean permissions to toolModes map */
export function migrateOldPermissions(
  metadata: Record<string, any> | null,
  config: Record<string, any>
): Record<string, ToolMode> {
  const modes: Record<string, ToolMode> = {}

  const mapping: Array<{ keys: string[]; tools: string[] }> = [
    { keys: ['allowWebSearch'], tools: ['web_search'] },
    { keys: ['allowFetch'], tools: ['fetch'] },
    { keys: ['allowDownload'], tools: ['download_image', 'download_file'] },
    { keys: ['allowWiseModel'], tools: ['wise_model'] },
    { keys: ['allowImageGeneration'], tools: ['generate_image', 'edit_image'] },
    { keys: ['allowEvalJs'], tools: ['eval_js'] },
    { keys: ['allowDelegate'], tools: ['delegate'] },
    { keys: ['allowCreateScript'], tools: ['create_script'] },
    { keys: ['allowReadLogs'], tools: ['read_logs'] },
    { keys: ['allowReadBacklinks'], tools: ['read_backlinks'] },
    { keys: ['allowReadTransactions'], tools: ['read_transactions'] },
    { keys: ['allowReadTasks'], tools: ['read_tasks'] },
    { keys: ['allowOpenFile'], tools: ['open'] },
  ]

  for (const entry of mapping) {
    const key = entry.keys[0]
    const value = metadata?.[key] ?? config[key]
    const mode: ToolMode = value ? 'auto' : 'ask'
    for (const tool of entry.tools) {
      modes[tool] = mode
    }
  }

  // Migrate per-script permissions
  const allowScripts = metadata?.allowScripts ?? config.allowScripts
  const allowedScripts = {
    ...(config.allowedScripts || {}),
    ...(config.scriptToolToggles || {}),
    ...(metadata?.allowedScripts || {}),
  }
  for (const [toolName, allowed] of Object.entries(allowedScripts)) {
    modes[toolName] = allowed ? 'auto' : 'ask'
  }
  // If blanket allowScripts was on, mark script_api_docs as auto
  if (allowScripts) {
    modes['script_api_docs'] = 'auto'
  }

  return modes
}

export interface ChatMessageUsage {
  input: number
  output: number
  total: number
  speed?: number // output tokens per second
}

export interface ChatMessageDiff {
  old: string
  new: string
}

export interface ChatMessage {
  id: string
  parentId?: string
  role: 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'system'
  content: string
  thinking?: string
  toolCallId?: string
  toolName?: string
  toolParams?: Record<string, unknown>
  toolStatus?: 'pending' | 'approved' | 'rejected' | 'modified'
  toolResult?: string
  toolDiff?: ChatMessageDiff
  usage?: ChatMessageUsage
  attachments?: string[]
  timestamp: number
}

export interface ChatMetadata {
  type: 'abele-chat'
  providerId: string
  modelId: string
  created: string
  title?: string
  pendingToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolModes?: Record<string, ToolMode>
  // Legacy fields for backwards compatibility (read-only during migration)
  allowWebSearch?: boolean
  allowFetch?: boolean
  allowDownload?: boolean
  allowWiseModel?: boolean
  allowImageGeneration?: boolean
  allowEvalJs?: boolean
  allowCreateFiles?: boolean
  allowDelegate?: boolean
  allowScripts?: boolean
  allowedScripts?: Record<string, boolean>
  allowCreateScript?: boolean
  allowReadLogs?: boolean
  allowReadBacklinks?: boolean
  allowReadTransactions?: boolean
  allowReadTasks?: boolean
  allowOpenFile?: boolean
  scopeEntries?: Array<{ type: 'file' | 'folder' | 'pattern' | 'group'; path: string }>
  fullVaultAccess?: boolean
  activeLeafId?: string
  customSystemPrompt?: string
  customSystemPromptNotePath?: string
}
