import { validatePath } from '@abele/sync-sdk/protocol'
import { LocalFolderPlacement, FolderScopeError } from './localFolderPlacement'

/** Project wire names onto the connection's unchanged saved namespace, never onto a new local root. */
export class ServerFolderPaths {
  constructor(
    readonly canonical: string,
    public remote: string
  ) {}
  map<T>(value: T, incoming: boolean): T {
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
    const visit = (one: unknown): unknown => {
      if (Array.isArray(one)) return one.map(visit)
      if (!one || typeof one !== 'object') return one
      return Object.fromEntries(
        Object.entries(one).map(([key, item]) => [
          key,
          ['path', 'prev_path', 'to_path', 'conflict_path'].includes(key) &&
          typeof item === 'string'
            ? incoming
              ? incomingPath(item)
              : placement.toServer(item)
            : visit(item),
        ])
      )
    }
    return visit(value) as T
  }
}
