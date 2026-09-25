import { DEFAULT_MEMORY_TEMPLATE } from './agents/memory'
import type { TFile } from 'obsidian'
import type { AgentDefinition, SessionOverrides } from './agents/types'
import type { MapBlock } from '@/helpers/mapConfig'
import type { McpServer } from './mcp/types'

/**
 * What is typed into the chat but not sent yet.
 *
 * Each tab keeps its own: switching to another conversation to look something up is not a
 * decision to throw away the message being composed in this one.
 */
export interface ChatDraft {
  text: string
  attachments: TFile[]
}

/** A message the person sent while the agent was working, waiting for the next iteration. */
export interface QueuedMessage {
  id: string
  content: string
  attachments?: string[]
}

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
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface AiPrompts {
  system: string
  titleGeneration: string
  titleSystem: string
  /** Asks the auxiliary model for the sentence shown on the card under a note this chat changed. */
  recapPrompt: string
  /** Asks the auxiliary model for the short summary shown under a chat's title in the history. */
  summaryPrompt: string
  compactPrompt: string
  /**
   * How an agent's memory is laid into its system prompt. `{{memory}}` stands for the list.
   * Optional because a prompts object saved before memory has none; blank means the default.
   */
  memoryTemplate?: string
  toolDescriptions: Record<string, string>
}

export type PermissionMode = 'confirm-all' | 'allow-edit' | 'allow-all'
export type ToolMode = 'off' | 'ask' | 'auto'

/**
 * A note a chat wrote to, and when it last did.
 *
 * Per note rather than one timestamp per chat: the card under a note says when *this* note was
 * changed, and a chat that worked on three notes over a week would otherwise date all three by
 * whichever it touched last.
 */
export interface TouchedNote {
  path: string
  /** ISO timestamp of the last write this chat made to `path`. */
  at: string
}

export interface AiChatHistoryEntry {
  path: string
  title: string
  created: string
  /**
   * Mirrored from the chat file's `touched`, so the footer under a note never opens a chat.
   * The file is the source of truth; this is a cache rebuilt by `refreshHistory`.
   */
  notes?: TouchedNote[]
  /** Mirrored from the chat file's `recap`. */
  recap?: string
  /** Mirrored from the chat file's `summary`, for the card in the history. */
  summary?: string
  /** Mirrored from the chat file's `agentId`, for the badge on the card. */
  agentId?: string
  /**
   * The file's `mtime` when the three fields above were last read out of it.
   *
   * The index is `data.json`, which does not merge across devices: a chat answered on a phone
   * arrives here as a file whose entry on this machine names no notes at all. So the file is
   * read back whenever it has moved on — and only then, because a chat folder is every
   * conversation ever had and each file is the whole of one.
   */
  mtime?: number
}

export interface AiSecret {
  name: string
  keyId: string // reference for Obsidian keychain
}

export type ImageApiType = 'openai' | 'openrouter'

export interface ImageModelConfig2 {
  id: string
  name: string
  size: string // openai: 1024x1024, 1536x1024, etc.
  outputFormat: string // openai: png, jpeg, webp
  quality: string // openai: low, medium, high
}

export interface ImageProvider {
  id: string
  name: string
  apiType: ImageApiType
  endpoint: string // empty = default for apiType
  apiKeyId: string // keychain reference
  models: ImageModelConfig2[]
}

export const IMAGE_API_DEFAULTS: Record<ImageApiType, string> = {
  openai: 'https://api.openai.com/v1/images/generations',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
}

/** Parse "providerId::modelId" key */
export function parseImageModelKey(key: string): { providerId: string; modelId: string } | null {
  const sep = key.indexOf('::')
  if (sep < 0) return null
  return { providerId: key.slice(0, sep), modelId: key.slice(sep + 2) }
}

/** Resolve provider + model from key and providers list */
export function resolveImageModel(
  key: string,
  providers: ImageProvider[]
): { provider: ImageProvider; model: ImageModelConfig2 } | null {
  const parsed = parseImageModelKey(key)
  if (!parsed) return null
  const provider = providers.find((p) => p.id === parsed.providerId)
  if (!provider) return null
  const model = provider.models.find((m) => m.id === parsed.modelId)
  if (!model) return null
  return { provider, model }
}

export interface AiInterceptor {
  id: string
  name: string
  systemPrompt: string
  modelId: string // provider model id (resolved same way as auxiliaryModelId)
  contextDepth: number // 0 = no context, -1 = all messages, N = last N messages
}

export interface InterceptorChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface VoiceSettings {
  modelId: string
  endpoint: string
  apiKeyId: string
  language: string
}

export interface RetrySettings {
  attempts: number
  firstDelayMs: number
}

export interface AiSettings {
  enabled: boolean
  providers: AiProvider[]
  activeProviderId: string
  activeModelId: string
  auxiliaryModelId: string
  sequentialAuxiliary: boolean
  permissionMode: PermissionMode
  toolModes: Record<string, ToolMode>
  scriptsEnabled: boolean
  scriptsFolder: string
  defaultScope: Array<{ type: 'file' | 'folder' | 'pattern' | 'group'; path: string }>
  defaultFullVaultAccess: boolean
  chatFolder: string
  /** Agent comment chats run on. The default agent when unset or pointing at a deleted one. */
  commentAgentId?: string
  /** Plain folder path — no template variables, so a marker's id is all a lookup needs. */
  commentFolder: string
  chatHistory: AiChatHistoryEntry[]
  braveSearchApiKey: string
  imageProviders: ImageProvider[]
  defaultImageModel: string // "providerId::modelId"
  secrets: AiSecret[]
  prompts: AiPrompts
  systemPromptFromNote: boolean
  systemPromptNotePath: string
  interceptors: AiInterceptor[]
  agents: AgentDefinition[]
  /** Id of the agent new chats start on. */
  defaultAgentId: string
  /** Voice input: which model turns speech into text, and where its key lives. */
  voice?: VoiceSettings
  /** Trying a failed request again on its own. Off unless asked for. */
  autoRetry?: RetrySettings
  /** MCP servers reached over HTTP, whose tools agents can be given. See `ai/mcp/`. */
  mcpServers?: McpServer[]
  /** @deprecated migrated to imageProviders */
  openRouterApiKey?: string
  /** @deprecated migrated to imageProviders */
  imageModel?: string
  /** @deprecated migrated to imageProviders */
  imageGeneration?: any
}

/**
 * The tool a comment chat uses to rewrite its own passage.
 *
 * Session-scoped: never in `createAgentTools()`, appended by `ChatSession.getTools` to a
 * comment that has a quote. Declared before `WRITE_TOOLS`, which names it.
 */
export const EDIT_SELECTION_TOOL = 'edit_selection'

/**
 * Tools that write to a file the vault already holds, or make a new one.
 *
 * These are what `allow-edit` stops asking about, which is why the list is shared: the
 * approval prompt offers that mode only for a call the mode would actually cover.
 */
export const WRITE_TOOLS = ['edit', 'create', 'replace', 'write', EDIT_SELECTION_TOOL]

/**
 * Tools whose success means a file in the vault changed — what links a chat to a note.
 *
 * Wider than `WRITE_TOOLS`: moving or copying a note produces one, and a note that arrived
 * that way was changed by the chat as surely as one it edited; so does `create_script`, whose
 * script lists its chats in the code view. `rm` is absent — a deleted note has no footer for
 * the link to show in.
 */
export const TOUCHING_TOOLS = [...WRITE_TOOLS, 'mv', 'cp', 'create_script']

/**
 * The tools that read the map — free, keyless, and on unless someone turns them off.
 *
 * Not core: they are the only tools that reach a third party without being asked to be
 * configured first, so a person who wants a vault that talks to nobody must be able to say no.
 */
export const MAP_TOOLS = ['geocode', 'places', 'route']

export const MAP_TOOL_MODES: Record<string, ToolMode> = {
  geocode: 'auto',
  places: 'auto',
  route: 'auto',
}

/**
 * The GitHub tools. They only read — GitHub itself stays read-only — and they are offered only
 * while the GitHub integration is on, so they are on for every agent unless turned off.
 */
export const GITHUB_TOOLS = [
  'github_views',
  'github_read',
  'github_pr_files',
  'github_file',
  'github_commits',
  'github_search',
  'github_grep',
  'github_open',
]

export const GITHUB_TOOL_MODES: Record<string, ToolMode> = Object.fromEntries(
  GITHUB_TOOLS.map((name) => [name, 'auto'])
)

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
  // Read-only, one small call, and the thing that stops an agent guessing at this vault's own
  // conventions. The other doc tools are opt-in because they are only wanted while writing the
  // thing they describe; this one is wanted before touching anything.
  'query_docs',
  // Reads the rest of a result too long to send whole. Without it a shortened answer would be
  // a dead end, so every agent has it. See `resultStore.ts`.
  'read_result',
])

/**
 * The book tools that only read. A discussion about words in a book (`CommentAnchor.cfi`) is
 * given them whatever its agent's tool modes say, scoped to the book.
 */
export const BOOK_READ_TOOLS = new Set([
  'book_views',
  'book_contents',
  'book_read',
  'book_search',
  'book_open',
])

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  providers: [],
  activeProviderId: '',
  activeModelId: '',
  auxiliaryModelId: '',
  sequentialAuxiliary: false,
  permissionMode: 'confirm-all',
  toolModes: {
    web_search: 'auto',
    chart_docs: 'auto',
    script_api_docs: 'auto',
    // The map tools need no key and no account, so there is nothing for a person to set up
    // before asking where something is. See `enableMapTools` for the agents that already exist.
    ...MAP_TOOL_MODES,
    ...GITHUB_TOOL_MODES,
  },
  scriptsEnabled: false,
  scriptsFolder: '',
  defaultScope: [],
  defaultFullVaultAccess: false,
  chatFolder: 'AI/Chats/{{name}}',
  commentFolder: 'AI/Comments',
  chatHistory: [],
  braveSearchApiKey: '',
  imageProviders: [],
  defaultImageModel: '',
  secrets: [],
  systemPromptFromNote: false,
  systemPromptNotePath: '',
  interceptors: [],
  agents: [],
  defaultAgentId: '',
  mcpServers: [],
  prompts: {
    system:
      "You are an AI assistant integrated into Obsidian note-taking app through the Abele plugin. You can read, create, edit, delete, and move files in the user's vault. You can also search the web.\n\nWhen working with files, always explain what you're about to do before doing it. Be concise but thorough.",
    titleGeneration:
      'Generate a short title (3-6 words, no quotes) for this conversation:\n\n{{messages}}',
    titleSystem: 'You generate concise chat titles. Reply with ONLY the title, nothing else.',
    recapPrompt:
      'In one sentence (max 20 words, no quotes), say what was done in this conversation and to which notes:\n\n{{messages}}',
    summaryPrompt:
      'In one or two sentences (max 35 words, no quotes), say what this conversation is about and what came out of it. Write in the language of the conversation:\n\n{{messages}}',
    memoryTemplate: DEFAULT_MEMORY_TEMPLATE,
    compactPrompt:
      'Summarize the conversation below into a concise context summary. Preserve key decisions, file paths, code changes, and any pending tasks. The summary will replace the conversation history, so include everything needed to continue the work.\n\n{{messages}}',
    // Overrides only: a tool's default description is its own (`toolDescriptionOverrides`).
    toolDescriptions: {},
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

/** Where a delegated run's transcript lives, hung off the tool call that started it. */
export interface SubAgentRunRef {
  runId: string
  agentId: string
  agentName: string
  /** Path of the run file, for opening the branch in its own tab. */
  path: string
  status: 'running' | 'done' | 'error' | 'aborted'
  branchCount: number
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
  /** A map a tool drew — shown under the call, the way a diff or a screenshot is. */
  toolMap?: MapBlock
  usage?: ChatMessageUsage
  attachments?: string[]
  timestamp: number
  draft?: boolean
  interceptorName?: string
  interceptorChat?: InterceptorChatMessage[]
  interceptorCollapsed?: boolean
  subAgentRun?: SubAgentRunRef
}

/** Where a comment chat sits: the note holding its marker, and the text it was made on. */
export interface CommentAnchor {
  /** The note the comment is in — or, when `message` is set, the chat whose answer it is on. */
  note: string
  /** The selected text. Absent for a cursor comment, which is anchored to a point. */
  quote?: string
  /**
   * The answer a comment in a chat is about, by message id. Set only for those: `note` then
   * names the chat file, and the passage is found through that chat's `comments`.
   */
  message?: string
  /**
   * The place in a book or PDF a discussion is about, as a highlight keeps it (an EPUB CFI; a
   * PDF page's text has one too). Set only for those: `note` then names the book, whose
   * highlights note lists the discussion — no marker is written anywhere.
   */
  cfi?: string
}

/**
 * A comment on a passage of one of this chat's answers, kept in the chat's own metadata — an
 * answer is drawn from markdown and has no text of ours to carry a marker in.
 */
export interface MessageComment {
  /** The comment's id, which is its file's basename in the comment folder. */
  id: string
  /** The answer it is on. */
  message: string
  /** The words selected, as the reader saw them. Absent for a comment on the whole answer. */
  quote?: string
  /** Where the quote starts in the answer's rendered text; the quote is looked for there first. */
  start?: number
}

export interface ChatMetadata {
  type: 'abele-chat'
  /** Which agent the chat runs on. Absent in chats saved before agents existed. */
  agentId?: string
  /** Absent means an ordinary chat. A comment keeps its kind once expanded, see `anchor`. */
  kind?: 'chat' | 'comment'
  /** Set for a comment and for a chat expanded from one, so the marker still finds the file. */
  anchor?: CommentAnchor
  /** Comments asked about passages of this chat's answers. Absent when there are none. */
  comments?: MessageComment[]
  /** Notes this chat wrote to, deduped by path, in the order they were first written. */
  touched?: TouchedNote[]
  /** One sentence on what this chat did, by the auxiliary model. Regenerated after a write. */
  recap?: string
  /**
   * A sentence or two on what the chat is about, by the auxiliary model, for the history list.
   * Written from the conversation's text alone — never from what its tools returned.
   */
  summary?: string
  /** Only what this chat changed relative to its agent. */
  overrides?: SessionOverrides
  providerId: string
  modelId: string
  created: string
  title?: string
  pendingToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  permissionMode?: PermissionMode
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
  interceptorAgentId?: string
  interceptorContextDepth?: number
  /** @deprecated pre-agent chats stored the interceptor id here; migrated on load. */
  activeInterceptorId?: string
}
