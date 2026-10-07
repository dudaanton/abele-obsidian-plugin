/**
 * Putting scripts from elsewhere in front of the person: one at a time, all that wait, and the
 * notice that says some arrived. The rules of what waits are `ScriptTrust.ts`; the dialog is
 * `reviewScript.ts`; the gate that sends a script here is `ScriptService.admit`.
 */
import { Notice } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptTrust } from './ScriptTrust'
import { reviewScript } from './reviewScript'
import type { ScriptService } from './ScriptService'
import type { ParsedScript } from './types'

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
  if (!yes || verdict === 'refused') return false
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
    new Notice(confirmed === 1 ? 'Script confirmed.' : `${confirmed} scripts confirmed.`)
  }
}

/**
 * Says once per version, per session, that scripts arrived that wait to be confirmed — with a
 * button that goes through them. A script only ever run by an automation or at startup would
 * otherwise just stop, with nothing on screen to say why.
 */
export function announceWaiting(service: ScriptService, announced: Set<string>): void {
  const fresh = service.waitingScripts().filter((s) => {
    const key = `${s.path}\0${s.hash}`
    if (announced.has(key)) return false
    announced.add(key)
    return true
  })
  if (!fresh.length) return
  const names = fresh.map((s) => `"${s.meta.name}"`).join(', ')
  const message =
    fresh.length === 1
      ? `Script ${names} changed without being written on this device. It will not run until you confirm it here.`
      : `${fresh.length} scripts changed without being written on this device: ${names}. They will not run until you confirm them here.`
  // A notice lives in the main window, so the bare factories — which build there — are right.
  const button = createEl('button', { text: 'Review', cls: 'mod-cta' })
  const fragment = createFragment()
  fragment.append(createDiv({ text: message }), button)
  const notice = new Notice(fragment, 0)
  button.addEventListener('click', () => {
    notice.hide()
    void reviewWaiting(service)
  })
}
