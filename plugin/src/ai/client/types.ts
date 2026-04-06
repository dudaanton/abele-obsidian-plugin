// ── Message types ────────────────────────────────────────────

export interface TextContent {
  type: 'text'
  text: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
}

export interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type AssistantContentBlock = TextContent | ThinkingContent | ToolCallContent

export interface UserMessage {
  role: 'user'
  content: string
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: AssistantContentBlock[]
  model: string
  usage: Usage
  stopReason: StopReason
  errorMessage?: string
  timestamp: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: TextContent[]
  isError: boolean
  timestamp: number
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
}

// ── Tool types ──────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema object
}

export interface AgentTool extends ToolDefinition {
  label: string
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult>
}

export interface AgentToolResult {
  content: TextContent[]
  details?: unknown
}

// ── Model / Provider types ──────────────────────────────────

export interface ModelConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  contextWindow: number
  maxTokens: number
  supportsReasoning: boolean
}

export interface StreamOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  reasoningEffort?: 'low' | 'medium' | 'high'
}

// ── Event types ─────────────────────────────────────────────

export type StreamEvent =
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end'; thinking: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; delta: string }
  | { type: 'tool_call_end'; toolCall: ToolCallContent }
  | { type: 'done'; message: AssistantMessage }
  | { type: 'error'; error: string; message?: AssistantMessage }

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'message_start'; message: Message }
  | { type: 'message_end'; message: Message }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | {
      type: 'tool_end'
      toolCallId: string
      toolName: string
      result: AgentToolResult
      isError: boolean
    }
