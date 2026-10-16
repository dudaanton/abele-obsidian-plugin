// The words and small helpers the node session's pieces share; what the session is lives in
// `@/node/sessionLive`.
import type { ChildState, PermissionMode } from '@/node/sessionLive'

export type {
  PermissionMode,
  SessionSettings,
  SessionChoice,
  SessionChoices,
  BackgroundTask,
  ContextUse,
  ChildState,
  ChildSession,
  SessionMark,
  NodeSessionLive,
} from '@/node/sessionLive'

/** «12k», «1M»: a token count the way a meter says it. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** «40s», «4m», «1h 12m», «3d»: how long something has gone on. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  // Past two days the hours stop saying anything; the days do.
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d`
}

export const MODE: Record<PermissionMode, { label: string; icon: string; said: string }> = {
  manual: { label: 'Ask every time', icon: 'hand', said: 'Asks before every action' },
  acceptEdits: {
    label: 'Accept edits',
    icon: 'file-pen-line',
    said: 'Edits files without asking; asks before commands',
  },
  auto: {
    label: 'Auto',
    icon: 'shield-check',
    said: 'Decides itself what is safe; asks about the rest',
  },
  plan: { label: 'Plan', icon: 'list-checks', said: 'Only reads and plans; changes nothing' },
  dontAsk: {
    label: "Don't ask",
    icon: 'shield-x',
    said: 'Never asks: does what is allowed beforehand and refuses the rest',
  },
  bypass: {
    label: 'Bypass',
    icon: 'shield-off',
    said: 'Runs everything without asking. Every action is in the chat; Stop is always here',
  },
}

export const CHILD_STATE: Record<ChildState, string> = {
  running: 'Working',
  waiting: 'Waits for you',
  failed: 'Stopped with an error',
  done: 'Done',
  stopped: 'Stopped',
}
