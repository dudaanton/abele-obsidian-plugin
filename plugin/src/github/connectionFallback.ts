import { GithubError } from './client'
import { ConnectionMemory, type ConnectionCandidate } from './connectionRouting'

export interface ConnectionAttempt {
  id: string
  error: string
  reason?: string
}
export interface ConnectionRead<T> {
  id: string
  value: T
  attempts: ConnectionAttempt[]
}
interface ReadOptions<T> {
  candidates: ConnectionCandidate[]
  repo: string
  item: string
  generation(id: string): string
  label?(id: string): string
  read(id: string): Promise<T>
  manual?: boolean
  retry?: boolean
}

/** Only the primary-item operation belongs here. Secondary failures and writes never enter it. */
export class ConnectionFallback {
  private pending = new Map<string, Promise<unknown>>()
  constructor(private readonly memory: ConnectionMemory) {}
  async read<T>(o: ReadOptions<T>): Promise<ConnectionRead<T>> {
    const attempts: ConnectionAttempt[] = []
    for (const candidate of o.manual ? o.candidates.slice(0, 1) : o.candidates) {
      const id = candidate.id,
        generation = o.generation(id)
      if (!o.retry && !o.manual && this.memory.wasRefused(id, generation, o.item)) {
        attempts.push({ id, error: 'Access was refused recently. Retry to check again.' })
        continue
      }
      try {
        const key = JSON.stringify([id, generation, o.item])
        let pending = this.pending.get(key) as Promise<T> | undefined
        if (!pending) {
          pending = o.read(id)
          this.pending.set(key, pending)
          void pending.then(
            () => this.pending.delete(key),
            () => this.pending.delete(key)
          )
        }
        const value = await pending
        if (o.generation(id) !== generation)
          throw new GithubError('other', 'The GitHub connection changed while loading.')
        this.memory.succeeded(o.repo, id, generation)
        return { id, value, attempts }
      } catch (e) {
        if (!(e instanceof GithubError) || !['not-found', 'forbidden', 'sso'].includes(e.kind))
          throw e
        this.memory.refused(id, generation, o.item)
        attempts.push({ id, error: e.message, reason: e.reason })
        if (o.manual) throw e
      }
    }
    throw new GithubError(
      'forbidden',
      attempts.length
        ? attempts.map((a) => `${o.label?.(a.id) ?? (a.id || 'Anonymous')}: ${a.error}`).join('\n')
        : 'No permitted GitHub connection is available for this server.'
    )
  }
}
