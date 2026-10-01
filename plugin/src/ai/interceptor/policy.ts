/**
 * An interceptor script answering for the person on the tool calls of one turn.
 *
 * It is consulted only where the person would have been asked. A call that runs without asking
 * is not its business, and a tool that is off is never offered in the first place. What it has
 * no answer for is asked about as usual.
 */

import { waitForScript } from '@/scripting/abort'

/** A call as the script sees it: a copy, so changing it changes nothing. */
export interface PolicyCall {
  name: string
  args: Record<string, unknown>
  /** The call reaches outside the chat's scope. Only a function may approve that. */
  outOfScope: boolean
}

export type ApproveSpec = true | string[] | ((call: PolicyCall) => unknown)

/** What the script returned, as it returned it. */
export interface ToolPolicySpec {
  approve: ApproveSpec
  deny: string[]
}

export type PolicyDecision =
  | { kind: 'approve' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask' }

/** How long a decision function may take before the person is asked instead. */
export const POLICY_DECISION_MS = 5000

export interface ToolPolicy {
  decide(call: PolicyCall): Promise<PolicyDecision>
}

const ASK: PolicyDecision = { kind: 'ask' }

function copyArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(args)
  } catch {
    return JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>
  }
}

export function toolPolicy(
  spec: ToolPolicySpec,
  scriptName: string,
  cancellation?: { signal: AbortSignal; onTimeout: () => void }
): ToolPolicy {
  const refused: PolicyDecision = {
    kind: 'deny',
    reason: `Refused by the interceptor script "${scriptName}"`,
  }

  return {
    async decide(call) {
      if (cancellation?.signal.aborted) return ASK
      if (spec.deny.includes(call.name)) return refused

      const approve = spec.approve
      if (typeof approve !== 'function') {
        // A blanket answer never reaches outside the scope: the person approving by hand is
        // what adds a path to it, and a list of tool names says nothing about paths.
        if (call.outOfScope) return ASK
        if (approve === true || approve.includes(call.name)) return { kind: 'approve' }
        return ASK
      }

      let timer = 0
      try {
        const decide = () => Promise.race([
          Promise.resolve().then(() =>
            approve({ name: call.name, args: copyArgs(call.args), outOfScope: call.outOfScope })
          ),
          new Promise<'timeout'>((resolve) => {
            timer = window.setTimeout(() => {
              resolve('timeout')
              cancellation?.onTimeout()
            }, POLICY_DECISION_MS)
          }),
        ])
        const answer = await (cancellation ? waitForScript(decide, cancellation.signal) : decide())
        if (answer === true) return { kind: 'approve' }
        if (answer === false) return refused
        if (answer === 'timeout') {
          console.warn(
            `[Abele interceptor] "${scriptName}" took longer than ${POLICY_DECISION_MS / 1000} s to decide on ${call.name}; asking instead`
          )
        }
        return ASK
      } catch (err) {
        if (cancellation?.signal.aborted) return ASK
        console.error(`[Abele interceptor] "${scriptName}" failed deciding on ${call.name}`, err)
        return ASK
      } finally {
        window.clearTimeout(timer)
      }
    },
  }
}
