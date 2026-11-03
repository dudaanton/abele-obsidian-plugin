import { connectionHost } from './connectionPaths'
import { caseKey } from '@abele/sync-sdk/protocol'
import { EngineError, type FileSystem } from '@abele/sync-sdk/core'
import type { InstallItem } from './nativeInstallBatch'

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
              if (error instanceof Error) reject(error)
              else {
                let detail = ''
                try {
                  if (error && typeof error === 'object') {
                    const message = Reflect.get(error, 'message'),
                      code = Reflect.get(error, 'code')
                    if (typeof message === 'string') detail = ': ' + message
                    if (typeof code === 'string' || typeof code === 'number')
                      detail += ' (' + code + ')'
                  } else detail = ': ' + String(error)
                } catch {
                  // A foreign error can have throwing accessors; still settle the lease.
                }
                reject(new Error('Path placement failed' + detail, { cause: error }))
              }
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
      if (key === Symbol.for('abele.sync.install-batch-v1') && typeof value === 'function')
        return (
          items: InstallItem[],
          work: (fs: FileSystem, flush: () => Promise<void>) => Promise<unknown>
        ) =>
          locks.run(
            items.map((item) => item.path),
            async () => {
              // Adoption never needs a preservation copy. Decline while holding
              // the lease, before treating existing bytes as an overwrite source.
              for (const item of items)
                if ((await target.stat(item.path)) !== null) return undefined
              const paths = items.map((item) => item.path)
              await beforePlacement(paths)
              assertHeld()
              const admitted = new Set(paths.map(caseKey))
              let active = true
              try {
                return await value.call(
                  target,
                  items,
                  (view: FileSystem, flush: () => Promise<void>) =>
                    work(
                      new Proxy(view, {
                        get(source, method) {
                          if (method === PLACEMENT)
                            return async <R>(requested: string[], run: () => Promise<R>) => {
                              if (!active || requested.some((path) => !admitted.has(caseKey(path))))
                                throw new EngineError(
                                  'conflict',
                                  'Placement is outside the active installation cohort'
                                )
                              assertHeld()
                              return run()
                            }
                          const member = Reflect.get(source, method)
                          return typeof member === 'function' ? member.bind(source) : member
                        },
                      }),
                      flush
                    )
                )
              } finally {
                active = false
              }
            },
            assertHeld
          )
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
