import { ScopeResolver } from './ScopeResolver'
import type { ChatSession } from './ChatSession'

/** Call-local identity: concurrent chats must never share an active scope or session. */
export interface ToolContext {
  scope: ScopeResolver
  session?: ChatSession
  agentId?: string
  skillCeiling?: ReadonlySet<string>
  interactive: boolean
  /** A person approved this particular call. */
  approved?: boolean
}

/** Direct script tool calls retain the plugin's default scope; chats always pass their own. */
export function scopeOf(ctx?: ToolContext): ScopeResolver {
  return ctx?.scope ?? ScopeResolver.getInstance()
}
