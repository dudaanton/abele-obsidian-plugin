/**
 * The tool policy an interceptor script gave the turn its message started.
 *
 * It holds from the send until the turn ends with nothing left to answer — a call left for the
 * person keeps it, since approving that call carries the same turn on. It ends early when a
 * message the script never saw joins the turn, or when the chat is stopped, cleared or
 * reopened. It is never saved: a chat opened again with a call waiting asks about it.
 *
 * Each call is decided once. The same call is looked at twice when the loop pauses — once as
 * the model asks for it, once as the queue it left is worked through — and a script whose
 * function has side effects should not be asked twice.
 */
import type { PolicyDecision, ToolPolicy } from './policy'

export class TurnPolicy {
  private policy: ToolPolicy | null = null
  private decided = new Map<string, Promise<PolicyDecision>>()

  set(policy: ToolPolicy | undefined): void {
    this.policy = policy ?? null
    this.decided = new Map()
  }

  clear(): void {
    this.set(undefined)
  }

  get active(): boolean {
    return this.policy !== null
  }

  /** Read a decision already made for this call; never invoke policy for an automatic call. */
  async isApproved(id: string): Promise<boolean> {
    const decisions = this.decided
    const answer = await decisions.get(id)
    // Stop/reset or a new turn invalidates approvals, including while this await settles.
    return this.decided === decisions && this.active && answer?.kind === 'approve'
  }

  decide(
    id: string,
    name: string,
    args: Record<string, unknown>,
    outOfScope: boolean
  ): Promise<PolicyDecision> {
    const policy = this.policy
    if (!policy) return Promise.resolve({ kind: 'ask' })
    let answer = this.decided.get(id)
    if (!answer) {
      answer = policy.decide({ name, args, outOfScope })
      this.decided.set(id, answer)
    }
    return answer
  }
}
