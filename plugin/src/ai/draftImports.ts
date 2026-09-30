/** A conversation's lifetime, independent of the tab or editor that currently displays it. */
export interface ConversationOwner {
  sessionId: string
  version: number
}

export function sameConversation(a?: ConversationOwner, b?: ConversationOwner): boolean {
  return a?.sessionId === b?.sessionId && a?.version === b?.version
}

/**
 * Ephemeral import state owned by a draft, not an editor instance. Replacing the draft's
 * contents redirects outstanding completions; unmounting an editor does not remove the
 * barrier. A new conversation invalidates the state rather than inheriting its imports.
 * Generic so neither files nor their storage API enter this lifetime model.
 */
export class DraftImports<D> {
  readonly pending = new Set<string>()
  active = true

  constructor(public target: D, readonly owner?: ConversationOwner) {}

  begin(key: string): (() => void) | null {
    if (!this.active || this.pending.has(key)) return null
    this.pending.add(key)
    return () => { this.pending.delete(key) }
  }

  redirect(target: D): void {
    this.target = target
  }

  retire(): void {
    this.active = false
  }
}
