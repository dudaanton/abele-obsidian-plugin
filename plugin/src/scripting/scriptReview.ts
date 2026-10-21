import { t } from '@/i18n'
/**
 * Putting scripts from elsewhere in front of the person: one at a time, all that wait, and the
 * notice that says some arrived. The rules of what waits are `ScriptTrust.ts`; the dialog is
 * `reviewScript.ts`; the gate that sends a script here is `ScriptService.admit`.
 */
import { Notice } from 'obsidian'
import { noticeWithActions, type ActionNotice } from '@/components/obsidian/notice'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptTrust } from './ScriptTrust'
import { reviewScript } from './reviewScript'
import type { ScriptService } from './ScriptService'
import type { ParsedScript } from './types'

const DISMISSED_NOTICE_KEY = 'abele-script-notice-dismissed'
const noticeVersion = (script: ParsedScript) => `${script.path}\0${script.hash}`
function dismissedNotices(): Set<string> {
  const saved: unknown = GlobalStore.getInstance().app?.loadLocalStorage?.(DISMISSED_NOTICE_KEY)
  return new Set(
    Array.isArray(saved)
      ? saved.filter((key): key is string => typeof key === 'string').slice(-256)
      : []
  )
}
function deferNotice(script: ParsedScript) {
  if (!script.hash) return
  const dismissed = dismissedNotices()
  const key = noticeVersion(script)
  dismissed.delete(key)
  dismissed.add(key)
  GlobalStore.getInstance().app?.saveLocalStorage?.(
    DISMISSED_NOTICE_KEY,
    [...dismissed].slice(-256)
  )
}

/**
 * Shows a script from elsewhere; true once this version is confirmed. A refused one is shown
 * with nothing to confirm. What is confirmed is the version shown — the index's, which is the
 * one that runs — not whatever the file holds by the time the button is pressed.
 */
export async function reviewOne(
  service: ScriptService,
  script: ParsedScript,
  signal?: AbortSignal
): Promise<boolean> {
  signal?.throwIfAborted()
  const verdict = service.verdict(script)
  if (verdict === 'confirmed') return true
  const { app } = GlobalStore.getInstance()
  const yes = await reviewScript(
    app,
    {
      script,
      previous: ScriptTrust.getInstance().lastConfirmed(script.path),
      refused: verdict === 'refused',
    },
    signal
  )
  // Confirm may have closed the dialog just before the run was cancelled.
  signal?.throwIfAborted()
  if (!yes) {
    deferNotice(script)
    return false
  }
  if (verdict === 'refused') return false
  service.confirm(script)
  return true
}

/** Every waiting script in turn, from the command and the notice. */
export async function reviewWaiting(service: ScriptService): Promise<void> {
  let confirmed = 0
  for (const script of service.waitingScripts()) {
    // The index may have moved on while an earlier one was open.
    const current = service.get(script.path)
    if (!current || service.verdict(current) === 'confirmed') continue
    if (await reviewOne(service, current)) confirmed++
  }
  if (confirmed) {
    new Notice(
      confirmed === 1
        ? t('streamC.478f6bd180062ca2')
        : t('streamC.f36a994f556e8457', { v1: String(confirmed) })
    )
  }
}

/**
 * Says once per version, per session, that scripts arrived that wait to be confirmed — with a
 * button that goes through them. A script only ever run by an automation or at startup would
 * otherwise just stop, with nothing on screen to say why.
 * A version explicitly deferred in review stays quiet across reloads; it is still unconfirmed.
 *
 * The notice stays until pressed, but only while something waits: confirmed or removed, the
 * scripts it names no longer need it, and a plugin that unloads takes it along — left behind,
 * its button would call a service that is gone. A newer arrival replaces it rather than
 * stacking a second one, and names every script still waiting.
 */
export class WaitingScriptsNotice {
  /** Versions of waiting scripts already announced this session, `path\0hash`. */
  private readonly announced = new Set<string>()
  private notice: ActionNotice | null = null

  constructor(private readonly service: Pick<ScriptService, 'waitingScripts' | 'reviewWaiting'>) {}

  announce(): void {
    const waiting = this.service.waitingScripts()
    const dismissed = dismissedNotices()
    const fresh = waiting.filter((s) => {
      const key = noticeVersion(s)
      if (dismissed.has(key)) return false
      if (this.announced.has(key)) return false
      this.announced.add(key)
      return true
    })
    if (!fresh.length) return this.settle()
    const named = this.notice ? waiting : fresh
    const names = named.map((s) => `"${s.meta.name}"`).join(', ')
    const message =
      named.length === 1
        ? t('streamC.718e67c242a1079f', { v1: String(names) })
        : t('streamC.0666f514c3023ab2', { v1: String(named.length), v2: String(names) })
    this.hide()
    this.notice = noticeWithActions(message, [
      {
        text: t('settings.ai.GeneralSettings.review.aff0766a'),
        tooltip: t('streamC.a7cafe8a03721d95'),
        accent: true,
        run: () => {
          this.hide()
          void this.service.reviewWaiting()
        },
      },
    ])
  }

  /** Closes the notice once nothing it could review is waiting any more. */
  settle(): void {
    if (this.notice && !this.service.waitingScripts().length) this.hide()
  }

  hide(): void {
    this.notice?.hide()
    this.notice = null
  }

  /** Every waiting version may be said again, as after the confirm-everything switch. */
  forget(): void {
    this.announced.clear()
  }
}
