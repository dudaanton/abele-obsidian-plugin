import { Notice } from 'obsidian'
import dayjs from 'dayjs'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { scriptParams } from '@/scripting/runScript'
import { showFormModal } from '@/scripting/formModal'
import { asText } from '@/helpers/headerButtons'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import { EVENT_LABELS, type AutomationEvent, type AutomationRule } from './types'

/**
 * Running one automation's script for one event.
 *
 * A failure is a failed run in the list of runs, like any script's, and one notice per rule a
 * minute at most: an automation runs without being asked, so nobody is watching for it, and a
 * rule that fails on every save must not bury the screen in notices either.
 */

/** Takes the chain that will be carried by whatever the script writes. */
export interface ChainMarker {
  markChain(path: string, chain: string[]): void
}

const NOTICE_EVERY_MS = 60_000
const lastNotice = new Map<string, number>()

/**
 * What a rule's parameter templates can use: the note's frontmatter — after the change, or
 * before it for a note that is gone — then `path`, `title`, `folder`, `type`, `date`, and the
 * event's own `event` and `oldPath`, laid over it.
 */
export function eventVariables(event: AutomationEvent): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.after ?? event.before ?? {})) {
    variables[key] = asText(value)
  }
  const name = event.path.split('/').pop() ?? event.path
  variables.path = event.path
  variables.title = name.replace(/\.md$/, '')
  variables.folder = event.path.slice(0, Math.max(0, event.path.length - name.length - 1))
  variables.type = event.type
  variables.date = dayjs().format(DATE_FORMAT)
  variables.event = event.kind
  variables.oldPath = event.oldPath ?? ''
  return variables
}

function tell(rule: AutomationRule, message: string): void {
  const now = Date.now()
  if (now - (lastNotice.get(rule.id) ?? 0) < NOTICE_EVERY_MS) return
  lastNotice.set(rule.id, now)
  new Notice(`Automation "${rule.name || rule.scriptName}" failed: ${message}`, 8000)
}

export async function runAutomation(
  rule: AutomationRule,
  event: AutomationEvent,
  chain: string[],
  marker: ChainMarker
): Promise<void> {
  const service = ScriptService.getInstance()
  const trigger = `${EVENT_LABELS[event.kind]} · ${event.path}`
  const script = service
    .getAll()
    .find(
      (candidate) => candidate.meta.name === rule.scriptName && candidate.meta.enabled !== false
    )

  if (!script) {
    const runs = ScriptRuns.getInstance()
    const id = runs.start({
      path: '',
      name: rule.scriptName,
      params: {},
      source: 'automation',
      stop: () => {},
      trigger,
    })
    const message = `script "${rule.scriptName}" was not found, or is switched off`
    runs.fail(id, message)
    tell(rule, message)
    return
  }

  const variables = eventVariables(event)
  const supplied: Record<string, string> = {}
  for (const [name, template] of Object.entries(rule.params)) {
    supplied[name] = renderTemplate(template, variables)
  }

  try {
    await service.execute(script.path, scriptParams(script, supplied), {
      source: 'automation',
      event,
      trigger,
      // The event happened here, on this device, because a person did something: a form the
      // script asks is shown to them like any other.
      formHandler: showFormModal,
      onWrite: (path) => marker.markChain(path, chain),
    })
  } catch (err) {
    tell(rule, err instanceof Error ? err.message : String(err))
  }
}

/** For tests: forget which rules have already said they failed. */
export function forgetNotices(): void {
  lastNotice.clear()
}
