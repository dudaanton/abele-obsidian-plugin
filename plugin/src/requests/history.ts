// The answers of earlier sends, read back from the node to show again or to compare.
import type { HttpOutcome } from '@/components/debugger/http/types'
import { evaluateChecks } from './resolve'
import { outcomeOf } from './shapes'
import type { HttpRpc } from './wire'

/** Of a body, what is read to show again or compare. */
const BODY_READ = 1024 * 1024

/** A kept body, page by page, up to what a tab holds. */
export async function wholeBody(rpc: HttpRpc, projectId: string, sendId: string) {
  let text = ''
  let from: number | undefined = 0
  while (from !== undefined && text.length < BODY_READ) {
    const page = await rpc.body(projectId, sendId, from)
    text += page.text
    from = page.next
  }
  return from === undefined ? text : `${text}\n… the rest is on the node`
}

/** An earlier send's answer as the tab shows it, its checks read again. */
export async function answerOf(
  rpc: HttpRpc,
  projectId: string,
  sendId: string,
  checks: string[]
): Promise<HttpOutcome> {
  const status = await rpc.status(projectId, sendId)
  const outcome = outcomeOf(status.outcome)
  if (outcome.kind !== 'answered' || status.outcome.state !== 'answered') return outcome
  const body = status.outcome.response.more
    ? await wholeBody(rpc, projectId, sendId)
    : outcome.response.body
  return {
    ...outcome,
    response: {
      ...outcome.response,
      body,
      ...(checks.length
        ? { checks: evaluateChecks(checks, { ...status.outcome.response, body }) }
        : {}),
    },
  }
}
