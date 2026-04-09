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

export interface AiChatHistoryEntry {
  path: string
  title: string
  created: string
}

export interface AiSettings {
  enabled: boolean
  providers: AiProvider[]
  activeProviderId: string
  activeModelId: string
  auxiliaryModelId: string
  wiseModelId: string
  sequentialAuxiliary: boolean
  permissionMode: PermissionMode
  allowWebSearch: boolean
  allowFetch: boolean
  allowWiseModel: boolean
  allowImageGeneration: boolean
  allowEvalJs: boolean
  defaultScope: Array<{ type: 'file' | 'folder' | 'pattern' | 'group'; path: string }>
  defaultFullVaultAccess: boolean
  chatFolder: string
  chatHistory: AiChatHistoryEntry[]
  braveSearchApiKey: string
  openRouterApiKey: string
  imageModel: string
  prompts: AiPrompts
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  providers: [],
  activeProviderId: '',
  activeModelId: '',
  auxiliaryModelId: '',
  wiseModelId: '',
  sequentialAuxiliary: false,
  permissionMode: 'confirm-all',
  allowWebSearch: true,
  allowFetch: false,
  allowWiseModel: false,
  allowImageGeneration: false,
  allowEvalJs: false,
  defaultScope: [],
  defaultFullVaultAccess: false,
  chatFolder: 'AI/Chats/{{name}}',
  chatHistory: [],
  braveSearchApiKey: '',
  openRouterApiKey: '',
  imageModel: 'google/gemini-2.5-flash-preview:thinking',
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
    },
  },
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
  allowWebSearch?: boolean
  allowFetch?: boolean
  allowWiseModel?: boolean
  allowImageGeneration?: boolean
  allowEvalJs?: boolean
  activeLeafId?: string
}
