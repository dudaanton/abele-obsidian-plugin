import { ScopeResolver } from './ScopeResolver'
import type { ChatSession } from './ChatSession'
import type { App } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

/** Call-local identity: concurrent chats must never share an active scope or session. */
export interface ToolContext {
  scope: ScopeResolver
  session?: ChatSession
  agentId?: string
  skillCeiling?: ReadonlySet<string>
  interactive: boolean
  /** A person approved this particular call. */
  approved?: boolean
  /** Original host and live invocation/write validity, currently consumed by create-only ZIP. */
  app?: App
  validateWrite?: () => void
}

/** The invocation's owned file facade; direct callers use the ordinary host. */
export function appOf(ctx?: ToolContext): App {
  return ctx?.app ?? GlobalStore.getInstance().app
}

/** Direct script tool calls retain the plugin's default scope; chats always pass their own. */
export function scopeOf(ctx?: ToolContext): ScopeResolver {
  return ctx?.scope ?? ScopeResolver.getInstance()
}
