import { t } from '@/i18n'
import { ref, type Ref } from 'vue'
import type { NodeClient } from '@abele/node-client'
import type { LiveSessionState } from '@abele/node-protocol'
import type { NodeProvider } from './providers'
import type { LiveProjection } from './liveTranscript'
import type { UpdateProjection } from './updateTranscript'
import type { NodeSessionLive, PermissionMode, SessionChoice, SessionSettings } from './sessionLive'

/** The node's word for a mode, and ours. */
const WIRE_MODE: Record<PermissionMode, string> = {
  manual: 'manual',
  acceptEdits: 'acceptEdits',
  auto: 'auto',
  plan: 'plan',
  dontAsk: 'dontAsk',
  bypass: 'bypassPermissions',
}
const modeOf = (wire: string): PermissionMode =>
  (Object.keys(WIRE_MODE) as PermissionMode[]).find((m) => WIRE_MODE[m] === wire) ?? 'manual'

/** Claude Code's model aliases: the node takes them, and does not list its models yet. */
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku']
const EFFORT_LABEL: Record<string, string> = {
  get low() {
    return t('streamB.low.f793de')
  },
  get medium() {
    return t('streamB.medium.8e588c')
  },
  get high() {
    return t('streamB.high.c4ebc6')
  },
  get xhigh() {
    return t('streamB.extraHigh.70eb32')
  },
  get max() {
    return t('streamB.max.a1a593')
  },
}

/** Known model families and versions from provider IDs; unknown names stay as reported. */
export function modelLabel(model: string): string {
  const gpt = /(?:^|\/)gpt[-_ ]?(\d+(?:[.-]\d+)*)(.*)$/i.exec(model)
  if (gpt) {
    const variant = gpt[2]
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    return `GPT-${gpt[1]}${variant ? ` ${variant}` : ''}`
  }
  const found = /(opus|sonnet|haiku|fable)(?:[-_ ]?(\d+(?:[-.]\d+)*))?/i.exec(model)
  if (!found) return model
  const family = found[1][0].toUpperCase() + found[1].slice(1).toLowerCase()
  return found[2] ? `${family} ${found[2].replace(/-/g, '.')}` : family
}

const accountLabel = (name: string): string =>
  name === 'default' ? t('streamB.mainSubscription.7b9f84') : name

/** The commands a node session takes after «/», before its skills. */
export const SESSION_COMMANDS: NodeSessionLive['commands'] = [
  {
    name: 'compact',
    get description() {
      return t('streamB.compactTheContext.64080c')
    },
    kind: 'command',
  },
  {
    name: 'model',
    get description() {
      return t('streamB.chooseTheModel.b5529e')
    },
    kind: 'command',
  },
  {
    name: 'effort',
    get description() {
      return t('streamB.chooseHowHardItThinks.9c5116')
    },
    kind: 'command',
  },
  {
    name: 'mode',
    get description() {
      return t('streamB.chooseWhatItAsksYouAbout.4091f5')
    },
    kind: 'command',
  },
  {
    name: 'rename',
    get description() {
      return t('streamB.renameTheSession.8b6333')
    },
    kind: 'command',
  },
  {
    name: 'stop',
    get description() {
      return t('streamB.stopTheSessionAndWhatItRuns.761fd9')
    },
    kind: 'command',
  },
]

export interface SessionActions {
  open: (sessionId: string) => void
  report: (error: unknown) => void
}

/**
 * How a long-lived session runs and the owner's levers on it: its settings read with
 * `session.state`, changed with `session.configure`, compacted, stopped and renamed. What it
 * shows comes from `session.state` together with the journal (`LiveTranscript`); the node's
 * description supplies the choices it offers.
 */
export class NodeSessionControl {
  readonly state: Ref<LiveSessionState | null> = ref(null)
  private reading?: Promise<void>
  private again = false

  constructor(
    private readonly client: () => NodeClient,
    private readonly sessionId: string,
    private readonly actions: SessionActions
  ) {}

  /** Reads the session's state again; calls while one read runs are folded into one more. */
  read(): Promise<void> {
    if (this.reading) {
      this.again = true
      return this.reading
    }
    this.reading = (async () => {
      do {
        this.again = false
        try {
          this.state.value = (await this.client().sessionState(this.sessionId)) as LiveSessionState
        } catch (error) {
          // An older node or a provider without long-lived sessions: nothing to show.
          console.debug('[Abele node] session.state unavailable', error)
          this.state.value = null
        }
      } while (this.again)
    })().finally(() => (this.reading = undefined))
    return this.reading
  }

  private async act(what: () => Promise<unknown>): Promise<void> {
    try {
      await what()
    } catch (error) {
      this.actions.report(error)
    }
    await this.read()
  }

  change(patch: Partial<SessionSettings>): Promise<void> {
    return this.act(() =>
      this.client().configureSession(this.sessionId, {
        ...(patch.model ? { model: patch.model } : {}),
        ...(patch.effort ? { effort: patch.effort as never } : {}),
        ...(patch.account ? { account: patch.account } : {}),
        ...(patch.mode ? { permission_mode: WIRE_MODE[patch.mode] as never } : {}),
      })
    )
  }

  /** `then` is sent once compacting is done; none, and the session waits for you. */
  compact(focus: string, then?: string): Promise<void> {
    return this.act(async () => {
      const settings = this.state.value?.settings
      if (then && then !== settings?.continuation_text)
        await this.client().configureSession(this.sessionId, { continuation_text: then })
      await this.client().compactSession(this.sessionId, {
        ...(focus ? { focus } : {}),
        continue: !!then,
      })
    })
  }

  stop(): Promise<void> {
    return this.act(() => this.client().stopSession(this.sessionId))
  }

  rename(title: string): Promise<void> {
    return this.act(() => this.client().renameSession(this.sessionId, title))
  }

  /**
   * The session as its chat shows it, or null when it is not a long-lived one: a provider that
   * runs one process per message, a node that does not say, a state not read yet.
   */
  view(
    provider: NodeProvider | undefined,
    journal: LiveProjection,
    agent?: UpdateProjection,
    name = 'claude'
  ): NodeSessionLive | null {
    const state = this.state.value
    if (!state?.live) return null
    const configuration = (provider?.configuration ?? {}) as {
      accounts?: string[]
      models?: string[]
      efforts?: string[]
      permission_modes?: string[]
    }
    // Some agents report the modes the node runs them in beside their configuration.
    const modes = configuration.permission_modes ?? provider?.permission_modes ?? []
    // Claude Code takes its aliases; any other agent offers the models it reported.
    const modelOption = agent?.options.find((o) => o.category === 'model')
    const accountOption = agent?.options.find((o) => o.id === 'account')
    const offered = modelOption?.options?.map((o) => o.value) ?? []
    const settings: SessionSettings = {
      model:
        state.settings.model === 'default' && name !== 'claude'
          ? modelOption?.current_value || state.context?.model || state.settings.model
          : state.settings.model,
      effort: state.settings.effort,
      account: state.settings.account,
      mode: modeOf(state.settings.permission_mode),
    }
    const models = [
      ...new Set(
        [
          ...(name === 'claude' ? MODEL_ALIASES : [...(configuration.models ?? []), ...offered]),
          settings.model,
        ].filter(Boolean)
      ),
    ]
    const choice = (id: string, label: string): SessionChoice => ({ id, label })
    const context =
      journal.context ??
      (state.context?.total_tokens != null && state.context.max_tokens
        ? { used: state.context.total_tokens, limit: state.context.max_tokens }
        : null)
    return {
      settings,
      choices: {
        models: models.map((m) =>
          choice(m, modelOption?.options?.find((o) => o.value === m)?.name || modelLabel(m))
        ),
        efforts: (configuration.efforts ?? Object.keys(EFFORT_LABEL)).map((e) =>
          choice(e, EFFORT_LABEL[e] ?? e)
        ),
        accounts: [...new Set([...(configuration.accounts ?? []), settings.account])].map((a) =>
          choice(
            a,
            accountOption?.options?.find((o) => o.value === a)?.name ||
              (name === 'claude'
                ? accountLabel(a)
                : a === 'default'
                  ? t('streamB.nodeDefaultAccount')
                  : a)
          )
        ),
        bypassAllowed: modes.includes('bypassPermissions'),
        // Claude Code takes every mode; any other agent asks every time or runs without asking,
        // the second only where its node allows it.
        ...(name !== 'claude' ? { modes: ['manual', 'bypass'] as PermissionMode[] } : {}),
      },
      context,
      compacting: journal.compacting || state.compacting,
      background: journal.tasks,
      children: [],
      commands: SESSION_COMMANDS,
      change: (patch) => void this.change(patch),
      compact: (focus, then) => void this.compact(focus, then),
      stop: () => void this.stop(),
      rename: (title) => void this.rename(title),
      open: (id) => this.actions.open(id),
    }
  }
}
