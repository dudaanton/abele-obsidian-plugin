import { t, currentLocale, numberFormatter } from '@/i18n'
// The words and small helpers the node session's pieces share; what the session is lives in
// `@/node/sessionLive`.
import type { ChildState, PermissionMode } from '@/node/sessionLive'
import type { SessionMark } from '@/node/sessionLive'
import { presentUiField } from '@/i18n/streamBErrors'

/** Transcript dividers only: queued wake rows must retain their visible system notice. */
export function hiddenTranscriptDivider(mark?: SessionMark): boolean {
  if (mark?.kind !== 'notice') return false
  const text = presentUiField(mark, 'text')
  return !text || text === t('chat.nodeActivityNotice')
}

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
  const locale = currentLocale()
  if (locale.language !== 'en')
    return numberFormatter(locale.format, {
      notation: 'compact',
      maximumFractionDigits: n >= 1_000_000 ? 1 : 0,
    }).format(n)
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** «40s», «4m», «1h 12m», «3d»: how long something has gone on. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const locale = currentLocale()
  const unit = (value: number, unit: 'second' | 'minute' | 'hour' | 'day') =>
    numberFormatter(locale.format, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value)
  if (locale.language !== 'en') {
    if (s < 60) return unit(s, 'second')
    const minutes = Math.floor(s / 60),
      hours = Math.floor(minutes / 60)
    if (minutes < 60) return unit(minutes, 'minute')
    return hours < 48
      ? `${unit(hours, 'hour')} ${unit(minutes % 60, 'minute')}`
      : unit(Math.floor(hours / 24), 'day')
  }
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  // Past two days the hours stop saying anything; the days do.
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d`
}

export const MODE: Record<PermissionMode, { label: string; icon: string; said: string }> = {
  manual: {
    get label() {
      return t('chat.askEvery')
    },
    icon: 'hand',
    get said() {
      return t('chat.asksEvery')
    },
  },
  acceptEdits: {
    get label() {
      return t('chat.acceptEdits')
    },
    icon: 'file-pen-line',
    get said() {
      return t('chat.acceptEditsSaid')
    },
  },
  auto: {
    get label() {
      return t('chat.auto')
    },
    icon: 'shield-check',
    get said() {
      return t('chat.autoSaid')
    },
  },
  plan: {
    get label() {
      return t('chat.plan')
    },
    icon: 'list-checks',
    get said() {
      return t('chat.planSaid')
    },
  },
  dontAsk: {
    get label() {
      return t('chat.dontAsk')
    },
    icon: 'shield-x',
    get said() {
      return t('chat.dontAskSaid')
    },
  },
  bypass: {
    get label() {
      return t('chat.bypass')
    },
    icon: 'shield-off',
    get said() {
      return t('chat.bypassSaid')
    },
  },
}

export const CHILD_STATE: Record<ChildState, string> = {
  get running() {
    return t('chat.working')
  },
  get waiting() {
    return t('chat.waits')
  },
  get failed() {
    return t('chat.stoppedError')
  },
  get done() {
    return t('chat.done')
  },
  get stopped() {
    return t('chat.stopped')
  },
}
