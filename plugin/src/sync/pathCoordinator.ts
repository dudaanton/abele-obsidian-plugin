import { connectionHost } from './connectionPaths'
import { caseKey } from '@abele/sync-sdk/protocol'
import type { FileSystem } from '@abele/sync-sdk/core'

export const PLACEMENT = Symbol.for('abele.sync.placement-v1')
const overlaps = (a: string, b: string) =>
  a === '' || b === '' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
interface Request {
  paths: string[]
  enter(): void
}

/** Atomic multi-path leases. Overlapping waiters are FIFO; unrelated paths never wait for them. */
export class PathCoordinator {
  private readonly active = new Set<Request>()
  private readonly waiting: Request[] = []
  run<T>(
    paths: readonly string[],
    work: () => Promise<T>,
    assertHeld: () => void = () => {}
  ): Promise<T> {
    const keys = [...new Set(paths.map((path) => caseKey(path).replace(/\/+$/, '')))].sort()
    return new Promise<T>((resolve, reject) => {
      const request: Request = {
        paths: keys,
        enter: () => {
          this.active.add(request)
          void (async () => {
            try {
              assertHeld()
              resolve(await work())
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new Error('Path placement failed', { cause: error })
              )
            } finally {
              this.active.delete(request)
              this.dispatch()
            }
          })()
        },
      }
      this.waiting.push(request)
      this.dispatch()
    })
  }
  private dispatch(): void {
    const blocked: Request[] = []
    for (const request of [...this.waiting]) {
      if (!this.waiting.includes(request)) continue
      const conflicts = (other: Request) =>
        request.paths.some((a) => other.paths.some((b) => overlaps(a, b)))
      if ([...this.active, ...blocked].some(conflicts)) {
        blocked.push(request)
        continue
      }
      this.waiting.splice(this.waiting.indexOf(request), 1)
      request.enter()
    }
  }
}

/** Core placement hook includes the state transaction, rather than locking individual syscalls. */
export function coordinatedFileSystem<T extends FileSystem>(
  fs: T,
  locks: PathCoordinator,
  assertHeld: () => void = () => {},
  beforePlacement: (paths: readonly string[]) => Promise<void> = async () => {}
): T {
  const run = <R>(
    paths: string[],
    work: () => Promise<R>,
    preserve: boolean | readonly string[] = true
  ) =>
    locks.run(
      paths,
      async () => {
        // Directory creation and byte adoption keep their leases without replacing file bytes.
        if (preserve === true) await beforePlacement(paths)
        else if (preserve !== false && preserve.length) await beforePlacement(preserve)
        assertHeld()
        return work()
      },
      assertHeld
    )
  return new Proxy(fs, {
    get(target, key) {
      if (key === PLACEMENT) return run
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const SHARED = Symbol.for('abele.sync.path-coordinator-v1')
/** Host identity, including module reloads, owns exclusion. No Obsidian dependency. */
export function pathCoordinatorOf(host: object): PathCoordinator {
  host = connectionHost(host)
  const value = host as { [SHARED]?: PathCoordinator }
  return (value[SHARED] ??= new PathCoordinator())
}
