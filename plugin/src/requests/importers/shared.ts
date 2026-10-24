// What every importer gives back, and the small rules they share: splitting a query off an
// address, reading a body's format, and leaving credentials out of the files a project may commit.
import type { EnvVar, Pair, RequestDoc } from '../wire'

export interface ImportedRequest {
  /** The folder it goes into, when the source says (a tag, a folder); else the import's. */
  collection?: string
  doc: RequestDoc
}

export interface Imported {
  /** The folder the requests go into unless one says otherwise. */
  collection: string
  requests: ImportedRequest[]
  /** Values for the environment: addresses and variables the source names. */
  vars: EnvVar[]
  /** What was left out because it carried a credential: headers by name, flags in words. */
  leftOut: string[]
  /** Unsupported source features, with the reason they need manual setup. */
  warnings?: string[]
  /** Requests of the source not brought in, each with why: `Upload avatar: a file body`. */
  skipped?: string[]
}

const SENSITIVE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i
/** A variable whose name says it holds a secret: imported without its value. */
export const SECRET_NAME = /(token|secret|password|passwd|api[_-]?key|auth|cookie|session)/i

/** A header that carries a credential written out: anything in it besides variables, keys by name
 * and the scheme's word. */
export function credential(key: string, value: string) {
  if (!SENSITIVE.test(key.trim())) return false
  const rest = value
    .replace(/\{\{[^}]*\}\}|\$\{abele_key:[^}]*\}/g, '')
    .replace(/^\s*(Bearer|Basic|Token|Digest)\b/i, '')
    .trim()
  return rest.length > 0
}

/** Literal portions of a secret remain sensitive even when mixed with key or variable references. */
export function literalSecretParts(value: string): string[] {
  return value.split(/\$\{abele_key:[^}]+\}|\{\{[^}]+\}\}/g).filter(Boolean)
}

/** A query or body field whose name says it holds a secret. */
export const SECRET_FIELD =
  /^(.*[_-])?(token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|key|secret|client[_-]?secret|password|passwd|pass|sig|signature|auth|session|sid)$/i

const literal = (v: unknown) =>
  typeof v === 'string' && v !== '' && !/^\{\{[^}]*\}\}$|^\$\{abele_key:[^}]*\}$/.test(v)

/** Every secret written out in a request's query or body becomes a variable kept in memory,
 * `{{name}}`, and is named as left out: what a project's files hold never carries one. */
export function scrubSecrets(imported: Imported): Imported {
  const vars = [...imported.vars]
  const leftOut = [...imported.leftOut]
  const secret = (name: string) => {
    if (!vars.some((v) => v.key === name)) vars.push({ key: name, secret: true })
    leave(leftOut, `the value of ${name}`)
    return `{{${name}}}`
  }
  const requests = imported.requests.map((r) => {
    const doc = { ...r.doc }
    doc.params = doc.params.map((p) =>
      SECRET_FIELD.test(p.key) && literal(p.value) ? { ...p, value: secret(p.key) } : p
    )
    if (doc.body?.format === 'form')
      doc.body = {
        ...doc.body,
        text: doc.body.text
          .split('&')
          .map((part) => {
            const eq = part.indexOf('=')
            const key = eq < 0 ? part : decodeURIComponent(part.slice(0, eq))
            return eq >= 0 && SECRET_FIELD.test(key) && literal(part.slice(eq + 1))
              ? `${part.slice(0, eq)}=${secret(key)}`
              : part
          })
          .join('&'),
      }
    else if (doc.body?.format === 'json') {
      try {
        let changed = false
        const walk = (v: unknown): unknown => {
          if (Array.isArray(v)) return v.map(walk)
          if (!v || typeof v !== 'object') return v
          return Object.fromEntries(
            Object.entries(v as Record<string, unknown>).map(([k, x]) => {
              if (SECRET_FIELD.test(k) && literal(x)) {
                changed = true
                return [k, secret(k)]
              }
              return [k, walk(x)]
            })
          )
        }
        const value = walk(JSON.parse(doc.body.text))
        if (changed) doc.body = { ...doc.body, text: JSON.stringify(value, null, 2) }
      } catch {
        // Not JSON after all: left as it is.
      }
    }
    return { ...r, doc }
  })
  return { ...imported, requests, vars, leftOut }
}

export function leave(leftOut: string[], what: string) {
  if (!leftOut.includes(what)) leftOut.push(what)
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

export function splitQuery(address: string): { url: string; params: Pair[] } {
  const at = address.indexOf('?')
  if (at < 0) return { url: address, params: [] }
  return {
    url: address.slice(0, at),
    params: address
      .slice(at + 1)
      .split('&')
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf('=')
        return eq < 0
          ? { key: decode(part), value: '' }
          : { key: decode(part.slice(0, eq)), value: decode(part.slice(eq + 1)) }
      }),
  }
}

export function bodyFormat(headers: Pair[], text: string): 'json' | 'text' | 'form' {
  const type = headers.find((h) => /^content-type$/i.test(h.key))?.value ?? ''
  if (/json/i.test(type)) return 'json'
  if (/x-www-form-urlencoded/i.test(type)) return 'form'
  if (!type && /^\s*[[{]/.test(text)) {
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      return 'text'
    }
  }
  return !type && /^[^\s=&]+=[^\s&]*(&[^\s=&]+=[^\s&]*)*$/.test(text.trim()) ? 'form' : 'text'
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type Method = (typeof METHODS)[number]
export const isMethod = (m: string): m is Method => (METHODS as readonly string[]).includes(m)

export function request(over: Partial<RequestDoc> & Pick<RequestDoc, 'name'>): RequestDoc {
  return { method: 'GET', url: '', params: [], headers: [], scripts: {}, checks: [], ...over }
}
