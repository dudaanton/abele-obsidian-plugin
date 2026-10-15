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
}

const SENSITIVE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i
/** A variable whose name says it holds a secret: imported without its value. */
export const SECRET_NAME = /(token|secret|password|passwd|api[_-]?key|auth|cookie|session)/i

/** A header that carries a credential written out, not as a variable or a key by name. */
export function credential(key: string, value: string) {
  return SENSITIVE.test(key.trim()) && !/\{\{|\$\{abele_key:/.test(value)
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
