import { validatePath } from '@abele/sync-sdk/protocol'
import { LocalFolderPlacement, FolderScopeError } from './localFolderPlacement'
import { yieldSyncTask } from './syncTaskBudget'

const PATH_KEYS = ['path', 'prev_path', 'to_path', 'conflict_path']

/** Project wire names onto the connection's unchanged saved namespace, never onto a new local root. */
export class ServerFolderPaths {
  constructor(
    readonly canonical: string,
    public remote: string
  ) {}
  map<T>(value: T, incoming: boolean): T {
    const project = this.projector(incoming)
    const visit = (one: unknown): unknown => {
      if (Array.isArray(one)) return one.map(visit)
      if (!one || typeof one !== 'object') return one
      return Object.fromEntries(
        Object.entries(one).map(([key, item]) => [
          key,
          PATH_KEYS.includes(key) && typeof item === 'string' ? project(item, key) : visit(item),
        ])
      )
    }
    return visit(value) as T
  }
  /** The same projection for a received page, yielding to the window between short slices:
   * a page names thousands of paths, and each is checked. */
  async mapAsync<T>(value: T, incoming: boolean): Promise<T> {
    const project = this.projector(incoming)
    let since = performance.now()
    const visit = async (one: unknown): Promise<unknown> => {
      if (performance.now() - since > 8) {
        await yieldSyncTask()
        since = performance.now()
      }
      if (Array.isArray(one)) {
        const out = []
        for (const item of one) out.push(await visit(item))
        return out
      }
      if (!one || typeof one !== 'object') return one
      const out: [string, unknown][] = []
      for (const [key, item] of Object.entries(one))
        out.push([
          key,
          PATH_KEYS.includes(key) && typeof item === 'string'
            ? project(item, key)
            : await visit(item),
        ])
      return Object.fromEntries(out)
    }
    return (await visit(value)) as T
  }
  private projector(incoming: boolean): (path: string, key: string) => string {
    const placement = new LocalFolderPlacement(this.remote, this.canonical)
    const incomingPath = (path: string) => {
      try {
        validatePath(path)
        return placement.toLocal(path)
      } catch {
        throw new FolderScopeError(
          'The server returned a path outside this connection; sync stopped: ' + path
        )
      }
    }
    return (path, key) =>
      incoming ? incomingPath(path) : placement.toServer(path, 'ServerFolderPaths.map.' + key)
  }
}
