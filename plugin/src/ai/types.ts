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

export type PermissionMode = 'confirm-all' | 'allow-edit' | 'allow-all'

export interface AiSettings {
  enabled: boolean
  providers: AiProvider[]
  activeProviderId: string
  activeModelId: string
  auxiliaryModelId: string
  permissionMode: PermissionMode
  chatFolder: string
  messageSeparator: string
  braveSearchApiKey: string
  systemPrompt: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  providers: [],
  activeProviderId: '',
  activeModelId: '',
  auxiliaryModelId: '',
  permissionMode: 'confirm-all',
  chatFolder: 'AI/Chats',
  messageSeparator: '<!-- abele-msg -->',
  braveSearchApiKey: '',
  systemPrompt: '',
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'system'
  content: string
  thinking?: string
  toolName?: string
  toolParams?: Record<string, unknown>
  toolStatus?: 'pending' | 'approved' | 'rejected' | 'modified'
  toolResult?: string
  timestamp: number
}

export interface ChatMetadata {
  type: 'ai-chat'
  providerId: string
  modelId: string
  created: string
  title?: string
}

export type ToolApprovalRequest = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  resolve: (result: ToolApprovalResult) => void
}

export type ToolApprovalResult = {
  approved: boolean
  modifiedArgs?: Record<string, unknown>
  reason?: string
}
