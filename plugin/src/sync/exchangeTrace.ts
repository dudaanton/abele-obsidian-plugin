import {
  countPullOperation,
  emptyPullCounts,
  emptyPullSummary,
  summarizePull,
  pullCountKeys,
} from './pullOperationCounts'
import { mobileReadSnapshot } from './mobileReadDiagnostics'

interface PullScope {
  active: boolean
  path?: string
  size: number
  counts: ReturnType<typeof emptyPullCounts>
  finish: (complete: boolean) => void
}
const noPull = (_complete: boolean): void => {}
const httpPattern = /^(GET|POST|PUT|DELETE|HEAD) /
const contentPattern = /^GET \/v2\/files\/[^/]+\/content$/
const tempPattern = /^\.abele-sync-[a-z0-9]{8}\.(tmp|old)$/
const ancestorPattern = /^(adapter (stat|exists|mkdir)|native (stat|mkdir))$/
const localKinds = [
  'adapter stat',
  'adapter exists',
  'adapter list',
  'adapter readBinary',
  'adapter writeBinary',
  'adapter write',
  'adapter appendBinary',
  'adapter rename',
  'adapter mkdir',
  'adapter remove',
  'adapter rmdir',
  'adapter copy',
  'native open r',
  'native open wx',
  'native read',
  'native write',
  'native close',
  'native sync',
  'native stat',
  'native rename',
  'native link',
  'native unlink',
  'native mkdir',
  'native utimes',
  'journal save',
  'pull hash',
  'other',
]

/** Device-local diagnostics. Recording performs no console/storage calls and retains no per-file map. */
export class ExchangeTrace {
  private pulling = false
  private writtenPaths: string[] = []
  private writes = 0
  private lastPull: { paths: string[]; writes: number; complete: boolean } | null = null
  written(path: string): void {
    this.writes++
    if (this.writtenPaths.length < 16 && !this.writtenPaths.includes(path))
      this.writtenPaths.push(path)
  }
  /** Keep the last pull that installed bytes visible through later no-op cycles. */
  finishPull(complete: boolean): void {
    if (this.writes || this.lastPull === null)
      this.lastPull = { paths: [...this.writtenPaths], writes: this.writes, complete }
    this.pulling = false
  }

  private readonly scopes: PullScope[] = Array.from({ length: 4 }, () => {
    const scope: PullScope = { active: false, size: 0, counts: emptyPullCounts(), finish: noPull }
    scope.finish = (complete) => this.endPull(scope, complete)
    return scope
  })
  private preparation = 0
  private readonly pulls = {
    small: emptyPullSummary(),
    large: emptyPullSummary(),
    failed: 0,
    overlap: false,
    contentRequests: 0,
    otherFileIo: emptyPullCounts(),
  }
  private sealed = false
  private total = 0
  private activeCount = 0
  private readonly active = Array.from({ length: 32 }, () => {
    const slot = {
      active: false,
      operation: '',
      startedAt: 0,
      stage: '',
      finish: (_completed = 0) => {},
    }
    slot.finish = (completed = 0) => this.finish(slot, completed)
    return slot
  })
  private readonly stages = {
    scan: { stage: 'scan', startedAt: 0, durationMs: 0, completed: 0 },
    compare: { stage: 'compare', startedAt: 0, durationMs: 0, completed: 0 },
    transfer: { stage: 'transfer', startedAt: 0, durationMs: 0, completed: 0 },
  }
  private readonly requests = Array.from({ length: 64 }, () => ({
    operation: '',
    startedAt: 0,
    durationMs: 0,
    outcome: '',
  }))
  private requestCount = 0
  private requestNext = 0
  private readonly scans = Array.from({ length: 32 }, () => ({
    operation: '',
    startedAt: 0,
    durationMs: 0,
    completed: 0,
  }))
  private scanCount = 0
  private scanNext = 0
  private readonly lines = new Array<string>(32).fill('')
  private lineCount = 0
  private lineNext = 0
  private readonly details = localKinds.map((operation) => ({
    operation,
    count: 0,
    durationMs: 0,
    maxMs: 0,
  }))
  private detailCount = 0

  beginPullCycle(): void {
    if (!this.pulling) {
      this.pulling = true
      this.writtenPaths = []
      this.writes = 0
    }
  }

  beginPull(size?: number, path?: string): (complete: boolean) => void {
    if (size === undefined) {
      this.beginPullCycle()
      return noPull
    }
    if (this.sealed) return noPull
    let scope: (typeof this.scopes)[number] | undefined
    for (const candidate of this.scopes)
      if (!candidate.active) {
        scope = candidate
        break
      }
    if (!scope) {
      this.pulls.overlap = true
      this.pulls.failed++
      return noPull
    }
    if (this.activeCount) this.pulls.overlap = true
    this.activeCount++
    scope.active = true
    scope.path = path
    scope.size = size
    for (const key of pullCountKeys) scope.counts[key] = 0
    return scope.finish
  }

  private endPull(scope: PullScope, complete: boolean): void {
    if (!scope.active) return
    this.activeCount--
    scope.active = false
    scope.path = undefined
    if (complete)
      summarizePull(scope.size <= 1024 * 1024 ? this.pulls.small : this.pulls.large, scope.counts)
    else this.pulls.failed++
  }

  async pull<T>(size: number, work: () => Promise<T>, path?: string): Promise<T> {
    const finish = this.beginPull(size, path)
    let complete = false
    try {
      const result = await work()
      complete = result === true
      return result
    } finally {
      finish(complete)
    }
  }

  inventory(total: number): void {
    if (!this.sealed) this.total = Math.max(this.total, total)
  }
  finishFirstSync(): void {
    this.sealed = true
  }

  begin(operation: string): (completed?: number) => void {
    let slot: (typeof this.active)[number] | undefined
    for (const candidate of this.active)
      if (!candidate.active) {
        slot = candidate
        break
      }
    if (!slot) {
      if (!this.sealed) this.pulls.overlap = true
      return () => {}
    }
    slot.active = true
    slot.operation = operation
    slot.startedAt = Date.now()
    slot.stage =
      operation === 'fs list'
        ? 'scan'
        : operation.startsWith('fs read ')
          ? 'compare'
          : httpPattern.test(operation)
            ? 'transfer'
            : ''
    if (operation === 'preserve local edit copies') this.preparation++
    if (!this.sealed && slot.stage) {
      const stage = this.stages[slot.stage as keyof typeof this.stages]
      if (!stage.startedAt) stage.startedAt = slot.startedAt
    }
    return slot.finish
  }

  private finish(slot: (typeof this.active)[number], completed: number): void {
    if (!slot.active) return
    slot.active = false
    if (slot.operation === 'preserve local edit copies') this.preparation--
    const durationMs = Date.now() - slot.startedAt
    if (!this.sealed && slot.stage) {
      const stage = this.stages[slot.stage as keyof typeof this.stages]
      stage.durationMs += durationMs
      stage.completed += slot.stage === 'scan' ? completed : 1
    }
    if (slot.operation === 'fs list') {
      const scan = this.scans[this.scanNext]
      scan.operation = slot.operation
      scan.startedAt = slot.startedAt
      scan.durationMs = durationMs
      scan.completed = completed
      this.scanNext = (this.scanNext + 1) % this.scans.length
      this.scanCount = Math.min(this.scanCount + 1, this.scans.length)
    }
    slot.operation = ''
  }

  async run<T>(operation: string, work: () => Promise<T>, retain = false): Promise<T> {
    const started = Date.now(),
      finish = this.begin(operation)
    let outcome = 'failed'
    try {
      const result = await work()
      outcome = 'complete'
      return result
    } finally {
      finish()
      if (retain || httpPattern.test(operation)) this.record(operation, started, outcome)
    }
  }

  record(operation: string, startedAt: number, outcome: string, paths?: readonly string[]): void {
    const content = contentPattern.test(operation)
    if (!this.sealed) {
      if (content) this.pulls.contentRequests++
      for (const scope of this.scopes)
        if (scope.active) {
          let belongs = !scope.path || !paths?.length
          if (scope.path && !belongs && paths)
            for (const path of paths)
              if (pullPathMatches(scope.path, path, operation)) {
                belongs = true
                break
              }
          countPullOperation(
            belongs ? scope.counts : this.pulls.otherFileIo,
            operation,
            1,
            belongs && this.preparation > 0
          )
        }
    }
    const request = this.requests[this.requestNext]
    request.operation = operation
    request.startedAt = startedAt
    request.durationMs = Date.now() - startedAt
    request.outcome = outcome
    this.requestNext = (this.requestNext + 1) % this.requests.length
    this.requestCount = Math.min(this.requestCount + 1, this.requests.length)
    const index = localKinds.indexOf(operation)
    const detail = this.details[index < 0 ? this.details.length - 1 : index]
    detail.count++
    detail.durationMs += request.durationMs
    detail.maxMs = Math.max(detail.maxMs, request.durationMs)
    this.detailCount++
  }

  log(line: string): void {
    this.lines[this.lineNext] = line
    this.lineNext = (this.lineNext + 1) % this.lines.length
    this.lineCount = Math.min(this.lineCount + 1, this.lines.length)
  }

  snapshot() {
    // Console output crosses a WebView bridge. Only an explicit snapshot pays that cost.
    if (this.detailCount) {
      console.debug(
        '[Abele Sync request batch]',
        this.details.filter((one) => one.count).map((one) => ({ ...one }))
      )
      for (const detail of this.details) {
        detail.count = 0
        detail.durationMs = 0
        detail.maxMs = 0
      }
      this.detailCount = 0
    }
    return {
      localReads: mobileReadSnapshot(),
      lastPull: this.lastPull ? { ...this.lastPull, paths: [...this.lastPull.paths] } : null,
      active: this.active
        .filter((one) => one.active)
        .map((one) => ({
          operation: one.operation,
          startedAt: one.startedAt,
          elapsedMs: Date.now() - one.startedAt,
        })),
      log: Array.from(
        { length: this.lineCount },
        (_, i) =>
          this.lines[(this.lineNext - this.lineCount + i + this.lines.length) % this.lines.length]
      ),
      requests: Array.from({ length: this.requestCount }, (_, i) => ({
        ...this.requests[
          (this.requestNext - this.requestCount + i + this.requests.length) % this.requests.length
        ],
      })),
      scans: Array.from({ length: this.scanCount }, (_, i) => ({
        ...this.scans[(this.scanNext - this.scanCount + i + this.scans.length) % this.scans.length],
      })),
      firstSync: {
        pulls: structuredClone(this.pulls),
        // Legacy event-map evidence is intentionally unavailable; exact aggregates never truncate.
        operations: {
          truncated: true,
          placements: [] as { path: string; counts: Record<string, number> }[],
          contentRequests: {} as Record<string, number>,
        },
        complete: this.sealed,
        total: this.total,
        stages: Object.values(this.stages)
          .filter((one) => one.startedAt)
          .map((one) => ({ ...one })),
      },
    }
  }
}

function pullPathMatches(target: string, path: string, operation: string): boolean {
  // Cold folder creation belongs to a pull only for the target's own ancestors or the shared
  // private staging root. Folders made meanwhile for other files or by the directory pass are
  // other file I/O, or every concurrent pull would be charged for them.
  const name = path.replaceAll('\\', '/').normalize('NFC'),
    wanted = target.normalize('NFC')
  if (
    ancestorPattern.test(operation) &&
    (name.endsWith('/plugins/abele/sync-staging') ||
      /(?:^|\/)\.abele-sync\/connections\/[^/]+\/writes$/.test(name) ||
      name === '.abele-sync-work' ||
      name.endsWith('/.abele-sync-work'))
  )
    return true
  if (name === wanted || name.endsWith('/' + wanted)) return true
  const cut = wanted.lastIndexOf('/'),
    parent = cut < 0 ? '' : wanted.slice(0, cut)
  const directory = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
  // Vault writers stage centrally, not beside the destination. Match only their private names.
  if (
    tempPattern.test(name.slice(name.lastIndexOf('/') + 1)) &&
    (directory === parent ||
      directory.endsWith('/' + parent) ||
      directory.endsWith('/plugins/abele/sync-staging') ||
      /(?:^|\/)\.abele-sync\/connections\/[^/]+\/writes$/.test(directory) ||
      directory === '.abele-sync-work' ||
      directory.endsWith('/.abele-sync-work'))
  )
    return true
  if (!ancestorPattern.test(operation)) return false
  // Creating the staging root may first create its own private parents.
  if (
    operation.endsWith(' mkdir') &&
    /(?:^|\/)\.abele-sync(?:\/connections(?:\/[^/]+)?)?$/.test(name)
  )
    return true
  // Any ancestor of the target, vault-relative or absolute (native paths carry the vault root).
  for (let at = wanted.indexOf('/'); at > 0; at = wanted.indexOf('/', at + 1)) {
    const ancestor = wanted.slice(0, at)
    if (name === ancestor || name.endsWith('/' + ancestor)) return true
  }
  return false
}
