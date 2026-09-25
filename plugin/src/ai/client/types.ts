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

export interface ImageUrlContent {
  type: 'image_url'
  image_url: { url: string }
}

export type UserContentPart = TextContent | ImageUrlContent

export interface UserMessage {
  role: 'user'
  content: string | UserContentPart[]
  timestamp: number
  chatMessageId?: string
  /** Notes whose text this message handed the agent — its attachments. See `ReadMark`. */
  reads?: ReadMark[]
}

export interface AssistantMessage {
  role: 'assistant'
  content: AssistantContentBlock[]
  model: string
  usage: Usage
  stopReason: StopReason
  errorMessage?: string
  timestamp: number
  chatMessageId?: string
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: TextContent[]
  isError: boolean
  timestamp: number
  /** Messages to inject after this tool result (e.g. user message with image) */
  injectMessages?: Message[]
  chatMessageId?: string
  /** What this call showed the agent of a file, or left in it. See `ReadMark`. */
  reads?: ReadMark[]
  /**
   * The whole of a result too big to send, when `content` is only the start of it. The model is
   * never sent this; `read_result` reads it by its key. See `resultStore.ts`.
   */
  stored?: StoredResult
}

/** A tool's whole answer, kept beside the shortened one the model was sent. */
export interface StoredResult {
  /** What the agent names it by, e.g. `r1a2b3c4d`. */
  key: string
  text: string
}

/**
 * The state of one file as the agent last saw it: by reading it, by having it attached, or by
 * writing it itself. It travels on the message that carried it, so a read counts exactly while
 * that message is in what the model is sent — a compacted, abandoned or never-saved turn takes
 * its reads with it. `readGuard.ts` is what reads these.
 */
export interface ReadMark {
  path: string
  /** `contentHash` of the file's text at that moment. */
  hash: string
  /** Milliseconds since the epoch. */
  at: number
  via: 'read' | 'attachment' | 'write'
  /** Set when only these lines (1-based, inclusive) were seen; absent for the whole file. */
  lines?: [number, number]
  /**
   * How many lines the file had, with `lines`: what lets two windows read one after the other
   * add up to the whole file.
   */
  total?: number
}

export interface SystemMessage {
  role: 'system'
  content: string
  timestamp: number
  chatMessageId?: string
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage | SystemMessage

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
  /** The group the settings show it in, for tools that bring their own (an MCP server's). */
  category?: string
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult>
}

export interface AgentToolResult {
  content: TextContent[]
  details?: unknown
  /** Extra messages injected into conversation after the tool result (e.g. image user messages) */
  injectMessages?: Message[]
  /**
   * The text of a file this call read or left behind, as the tool saw it. Only the session's
   * read guard looks at it; it turns it into the `reads` of the tool's result message.
   */
  seen?: { path: string; hash: string; lines?: [number, number]; total?: number }
  /** Filled by the session's read guard, carried onto the result message by whoever makes it. */
  reads?: ReadMark[]
  /** Filled by the session's result store when the answer was too big to send whole. */
  stored?: StoredResult
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
  reasoningEffort?: 'low' | 'medium' | 'high'
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
