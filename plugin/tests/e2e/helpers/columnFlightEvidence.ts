import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { COLUMN_FLIGHT_BUFFER, COLUMN_FLIGHT_FLAG } from '../../../src/columns/flight'
import { phoneEval, driver } from './phone'
import { shotPath } from './shots'

const MAX_CHARS = 256 * 1024
const MAX_FILES = 32
const directory = () => shotPath('columns-flight')
const pendingPath = () => join(directory(), 'pending.json')
const transportFailure =
  /phone (?:gave no answer|driver failed|driver transport)|phone host transport|phone.*(?:eval|transport).*tim(?:e|ed)[ -]?out/i

type Liveness = {
  status: 'answered' | 'unavailable'
  appRunning?: boolean
  webContentRunning?: boolean
}

/** Native status is advisory, never evidence of JavaScript responsiveness or CPU use. */
function liveness(value: unknown): Liveness {
  const result: Liveness = { status: 'unavailable' }
  if (!value || typeof value !== 'object') return result
  const source = value as Record<string, unknown>
  if (source.status === 'answered') result.status = 'answered'
  for (const key of ['appRunning', 'webContentRunning'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  // Migrate pending markers written before native status was allowlisted.
  if (typeof source.status === 'string' && source.status.startsWith('{')) {
    return nativeLiveness(source.status)
  }
  return result
}

function nativeLiveness(raw: string): Liveness {
  const result: Liveness = { status: 'answered' }
  try {
    if (raw.length > 32 * 1024) return result
    const source = JSON.parse(raw) as Record<string, unknown> | null
    if (!source || typeof source !== 'object') return result
    for (const key of ['appRunning', 'webContentRunning'] as const) {
      if (typeof source[key] === 'boolean') result[key] = source[key]
    }
    if (source.app === 'running') result.appRunning = true
    if (source.app === 'stopped' || source.app === 'crashed') result.appRunning = false
  } catch {
    // An answered probe can still contain no usable liveness fields.
  }
  return result
}

/** Diagnostics only: never turn an assertion into a pass or fail a test on an artifact error. */
export function noteColumnPhoneFailure(file: string, test: string, errors: string[]): void {
  if (
    !/(?:^|\/)(?:columns|columnSafety|columnAside|columnsContent|columnsFreezeStress)\.e2e\.test\.ts$/.test(
      file
    ) ||
    !errors.some((error) => transportFailure.test(error))
  )
    return
  try {
    mkdirSync(directory(), { recursive: true })
    const path = pendingPath()
    if (existsSync(path)) return
    const failure = {
      at: Date.now(),
      file: file.split('/').pop(),
      test: test.slice(0, 500),
      errors: errors.slice(0, 3).map((error) => error.slice(0, 1500)),
      liveness: { status: 'unavailable' } as Liveness,
    }
    writeFileSync(path, JSON.stringify(failure), { flag: 'wx' })
    try {
      failure.liveness = nativeLiveness(driver(['status'], 5000))
    } catch {
      failure.liveness = { status: 'unavailable' }
    }
    const temporary = path + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temporary, JSON.stringify(failure), { flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
    console.warn('[columns-flight] phone transport failed; pending evidence:', path)
  } catch (error) {
    console.warn('[columns-flight] could not mark failure:', String(error).slice(0, 500))
  }
}

/** Called after normal recovery, and again before arming: disk save must precede any new buffer. */
export function saveColumnFlightAfterRecovery(pendingOnly = false): boolean {
  try {
    if (pendingOnly && !existsSync(pendingPath())) return true
    const pending = existsSync(pendingPath())
      ? (JSON.parse(readFileSync(pendingPath(), 'utf8').slice(0, 128 * 1024)) as unknown)
      : undefined
    if (pending && typeof pending === 'object') {
      const failure = pending as Record<string, unknown>
      failure.liveness = liveness(failure.liveness)
    }
    const raw = phoneEval(
      `(() => {
      if (${pending !== undefined}) {
        localStorage.removeItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)});
        window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(COLUMN_FLIGHT_FLAG)}}));
      }
      const text=localStorage.getItem(${JSON.stringify(COLUMN_FLIGHT_BUFFER)}) || '';
      return {timeOrigin:performance.timeOrigin,text:text.slice(-${MAX_CHARS}),originalChars:text.length,truncated:text.length>${MAX_CHARS}};
    })()`,
      5000
    )
    if (!raw.startsWith('=> ')) throw new Error('buffer probe did not answer: ' + raw.slice(0, 300))
    const reply = JSON.parse(raw.slice(3)) as {
      timeOrigin: number
      text: string
      originalChars: number
      truncated: boolean
    }
    if (
      typeof reply.text !== 'string' ||
      reply.text.length > MAX_CHARS ||
      typeof reply.timeOrigin !== 'number'
    )
      throw new Error('invalid buffer envelope')
    let buffer: unknown = null
    if (reply.text && !reply.truncated) {
      try {
        buffer = JSON.parse(reply.text)
      } catch {
        /* Preserve malformed storage verbatim below. */
      }
    }
    if (!pending && !reply.text) return true
    mkdirSync(directory(), { recursive: true })
    const hash = createHash('sha256').update(reply.text).digest('hex').slice(0, 24)
    const path = join(directory(), 'flight-' + hash + '.json')
    if (!existsSync(path)) {
      if (readdirSync(directory()).filter((file) => file.startsWith('flight-')).length >= MAX_FILES)
        throw new Error('artifact limit reached; old buffer retained')
      const evidence = {
        savedAt: Date.now(),
        recoveredTimeOrigin: reply.timeOrigin,
        failure: pending ?? null,
        buffer,
        ...(buffer === null ? { bufferTextTail: reply.text } : {}),
        originalChars: reply.originalChars,
        truncated: reply.truncated,
      }
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        writeFileSync(temporary, JSON.stringify(evidence), { flag: 'wx' })
        renameSync(temporary, path)
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary)
      }
    }
    if (pending !== undefined) unlinkSync(pendingPath())
    console.info('[columns-flight] recovered evidence:', path)
    return true
  } catch (error) {
    console.warn(
      '[columns-flight] evidence not saved; recorder will not be rearmed:',
      String(error).slice(0, 500)
    )
    return false
  }
}

export function enablePhoneColumnFlight(): boolean {
  if (!saveColumnFlightAfterRecovery()) return false
  try {
    phoneEval(
      `localStorage.setItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)},String(performance.timeOrigin));window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(COLUMN_FLIGHT_FLAG)}}));true`,
      5000
    )
    return true
  } catch (error) {
    console.warn('[columns-flight] recorder activation failed:', String(error).slice(0, 500))
    return false
  }
}
