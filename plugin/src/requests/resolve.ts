// A saved request made ready to go: the environment's `{{variables}}` put in, the query built from
// the lines that are on, keys left as `${abele_key:name}` for the key store to fill at the last
// moment. Pure, so what is sent is tested without a node, a key store or Obsidian.
import type { HttpCheck, HttpPair } from '@/components/debugger/http/types'
import type { EnvironmentDoc, Method, Pair, RequestDoc } from './wire'

const VAR = /\{\{\s*([\w.-]+)\s*\}\}/g
const KEY = /\$\{abele_key:([^}]+)\}/g

/** What the request goes out with: the environment's values that are on, secrets from memory. */
export function varsOf(
  env: EnvironmentDoc | undefined,
  secrets: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of env?.vars ?? []) {
    if (v.off) continue
    const value = v.secret ? secrets[v.key] : v.value
    if (value !== undefined) out[v.key] = value
  }
  return out
}

export function fill(text: string, vars: Record<string, string>) {
  return text.replace(VAR, (whole, name: string) => vars[name] ?? whole)
}

/** Encodes a part of the query but leaves a key's placeholder for the key store to find. */
function encodePart(text: string) {
  let out = ''
  let at = 0
  for (const m of text.matchAll(KEY)) {
    out += encodeURIComponent(text.slice(at, m.index)) + m[0]
    at = m.index + m[0].length
  }
  return out + encodeURIComponent(text.slice(at))
}

const on = (pairs: Pair[]) => pairs.filter((p) => !p.off && p.key.trim())

export function addressOf(doc: RequestDoc, vars: Record<string, string>) {
  const query = on(doc.params)
    .map((p) => `${encodePart(fill(p.key, vars))}=${encodePart(fill(p.value, vars))}`)
    .join('&')
  const url = fill(doc.url, vars)
  return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url
}

export interface Outgoing {
  method: Method
  url: string
  headers: Record<string, string>
  body?: string
}

export function outgoing(doc: RequestDoc, vars: Record<string, string>): Outgoing {
  const headers: Record<string, string> = {}
  for (const h of on(doc.headers)) headers[fill(h.key, vars).trim()] = fill(h.value, vars)
  const body =
    doc.body?.text && doc.method !== 'GET' && doc.method !== 'HEAD'
      ? fill(doc.body.text, vars)
      : undefined
  if (
    body !== undefined &&
    doc.body?.format === 'json' &&
    !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
  )
    headers['Content-Type'] = 'application/json'
  return {
    method: doc.method,
    url: addressOf(doc, vars),
    headers,
    ...(body !== undefined ? { body } : {}),
  }
}

function texts(doc: RequestDoc) {
  return [
    doc.url,
    ...on(doc.params).flatMap((p) => [p.key, p.value]),
    ...on(doc.headers).flatMap((h) => [h.key, h.value]),
    ...(doc.method !== 'GET' && doc.method !== 'HEAD' && doc.body ? [doc.body.text] : []),
  ]
}

/** The keys a request names, in the order they appear. */
export function keyNamesOf(doc: RequestDoc): string[] {
  return [...new Set(texts(doc).flatMap((t) => [...t.matchAll(KEY)].map((m) => m[1])))]
}

/** The variables a request uses that the environment has no value for. */
export function missingVars(doc: RequestDoc, vars: Record<string, string>): string[] {
  return [
    ...new Set(
      texts(doc)
        .flatMap((t) => [...t.matchAll(VAR)].map((m) => m[1]))
        .filter((name) => vars[name] === undefined)
    ),
  ]
}

/** Why a request cannot go as it is, in words: a variable with no value, a key not there. */
export function whyBlocked(
  doc: RequestDoc,
  vars: Record<string, string>,
  environment: string | undefined,
  hasKey: (name: string) => boolean
): string | undefined {
  const missing = missingVars(doc, vars)[0]
  if (missing) return `${missing} has no value in ${environment ?? 'any environment'}`
  const absent = keyNamesOf(doc).find((name) => !hasKey(name))
  return absent ? `The key ${absent} is not on this device` : undefined
}

/** Lines as the tab draws them: a key's line says so, and why it cannot go when it cannot. */
export function pairsForView(pairs: Pair[], hasKey: (name: string) => boolean): HttpPair[] {
  return pairs.map((p) => {
    const names = [...p.value.matchAll(KEY)].map((m) => m[1])
    const absent = names.find((n) => !hasKey(n))
    return {
      key: p.key,
      value: p.value,
      ...(p.off ? { off: true } : {}),
      ...(names.length ? { secret: true } : {}),
      ...(absent ? { missing: `The key ${absent} is not on this device` } : {}),
    }
  })
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The request as a curl line, keys still by name: copying never puts a key on the clipboard. */
export function toCurl(out: Outgoing): string {
  return [
    'curl',
    ...(out.method !== 'GET' ? ['-X', out.method] : []),
    quote(out.url),
    ...Object.entries(out.headers).flatMap(([k, v]) => ['-H', quote(`${k}: ${v}`)]),
    ...(out.body !== undefined ? ['--data-raw', quote(out.body)] : []),
  ].join(' ')
}

export interface CheckedAnswer {
  status: number
  ms: number
  bytes: number
  headers: { key: string; value: string }[]
  body: string
}

type Op = '==' | '!=' | '<=' | '>=' | '<' | '>' | 'contains'

function literal(text: string): unknown {
  const t = text.trim()
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

function at(value: unknown, path: string): unknown {
  let current = value
  for (const m of path.matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[m[1] ?? m[2]]
  }
  return current
}

function compare(actual: unknown, op: Op, expected: unknown): boolean {
  if (op === 'contains')
    return (
      actual !== undefined &&
      (typeof actual === 'string' ? actual : JSON.stringify(actual)).includes(
        typeof expected === 'string' ? expected : JSON.stringify(expected)
      )
    )
  if (op === '==') return JSON.stringify(actual) === JSON.stringify(expected)
  if (op === '!=') return JSON.stringify(actual) !== JSON.stringify(expected)
  const a = Number(actual),
    b = Number(expected)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b
}

/** One check of an answer: `status == 201`, `ms < 500`, `header content-type contains json`,
 * `body.items[0].qty == 2`, `body contains done`. A check that cannot be read fails. */
function check(text: string, answer: CheckedAnswer): boolean {
  const m =
    /^\s*(status|ms|bytes|header\s+[\w-]+|body((?:\.[^\s.[\]]+|\[\d+\])*))\s+(==|!=|<=|>=|<|>|contains)\s+(.+)$/.exec(
      text
    )
  if (!m) return false
  const [, subject, path, op, raw] = m
  let actual: unknown
  if (subject === 'status') actual = answer.status
  else if (subject === 'ms') actual = answer.ms
  else if (subject === 'bytes') actual = answer.bytes
  else if (subject.startsWith('header')) {
    const name = subject.split(/\s+/)[1].toLowerCase()
    actual = answer.headers.find((h) => h.key.toLowerCase() === name)?.value
  } else if (!path) actual = answer.body
  else {
    try {
      actual = at(JSON.parse(answer.body), path)
    } catch {
      return false
    }
  }
  const expected = op === 'contains' ? raw.trim() : literal(raw)
  return compare(actual, op as Op, expected)
}

export function evaluateChecks(checks: string[], answer: CheckedAnswer): HttpCheck[] {
  return checks.map((text) => ({ text, passed: check(text, answer) }))
}
