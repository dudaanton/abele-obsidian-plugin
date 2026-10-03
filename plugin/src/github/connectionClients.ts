import { GithubClient, type Requester } from './client'
import { endpoints } from './urls'
import type { GithubConnection } from './connections'

/** Connection credentials are captured once per generation, never rediscovered halfway through a load. */
export class ConnectionClients {
  private clients = new Map<string, { signature: string; client: GithubClient }>()
  constructor(
    private readonly connections: () => GithubConnection[],
    private readonly secret: (keyId: string) => string,
    private readonly secretState: () => string,
    private readonly transport?: Requester,
    private readonly onRetire: () => void = () => {}
  ) {}

  reconcile(): void {
    const rows = this.connections()
    for (const [id, entry] of this.clients) {
      const row = rows.find((c) => c.id === id)
      if (!row || entry.signature !== this.signature(row)) {
        entry.client.retire()
        this.clients.delete(id)
        this.onRetire()
      }
    }
  }

  private signature(c: GithubConnection): string {
    // This secret-bearing signature stays private to the registry, never in a cache key or output.
    return JSON.stringify([c.server, c.keyId, this.secret(c.keyId).trim(), this.secretState()])
  }

  client(id: string): GithubClient {
    this.reconcile()
    const row = this.connections().find((c) => c.id === id)
    if (!row) throw new Error('The GitHub connection was deleted or is unknown.')
    const found = this.clients.get(id)
    if (found) return found.client
    const token = this.secret(row.keyId).trim()
    const client = new GithubClient(
      endpoints(row.server),
      token,
      this.transport,
      row.keyId && !token
        ? 'The connection token is unavailable on this device; unlock synced keys or add the token.'
        : undefined
    )
    this.clients.set(id, { signature: this.signature(row), client })
    return client
  }

  clear(): void {
    for (const entry of this.clients.values()) entry.client.retire()
    if (this.clients.size) this.onRetire()
    this.clients.clear()
  }
}
