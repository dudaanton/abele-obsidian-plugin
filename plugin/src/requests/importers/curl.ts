// A curl line as browsers and docs copy it. Its words are read as a shell would split them;
// a credential (an Authorization header, a cookie, `-u user:password`) is left out and named.
import type { Pair } from '../wire'
import {
  bodyFormat,
  credential,
  isMethod,
  leave,
  request,
  splitQuery,
  type Imported,
} from './shared'

/** Words as a POSIX shell splits them: quotes, backslashes and line continuations. */
export function shellWords(text: string): string[] {
  const words: string[] = []
  let word = ''
  let started = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '\\' && text[i + 1] === '\n') {
      i++
      continue
    }
    if (/\s/.test(c)) {
      if (started) words.push(word)
      word = ''
      started = false
      continue
    }
    started = true
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      word += text.slice(i + 1, end < 0 ? undefined : end)
      i = end < 0 ? text.length : end
    } else if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\' && /["\\$`\n]/.test(text[i + 1] ?? '')) i++
        word += text[i]
      }
    } else if (c === '\\') word += text[++i] ?? ''
    else word += c
  }
  if (started) words.push(word)
  return words
}

const NO_VALUE = new Set([
  '--compressed',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-i',
  '--include',
  '-v',
  '--verbose',
  '-f',
  '--fail',
  '-g',
  '--globoff',
])
const IGNORED = new Set([
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '-w',
  '--write-out',
  '--retry',
])

export function importCurl(text: string): Imported {
  const words = shellWords(text.trim())
  const leftOut: string[] = []
  const headers: Pair[] = []
  const data: string[] = []
  const encoded: string[] = []
  let method: string | undefined
  let address = ''
  let get = false
  for (let i = words[0] === 'curl' ? 1 : 0; i < words.length; i++) {
    const w = words[i]!
    const next = () => words[++i] ?? ''
    if (w === '-X' || w === '--request') method = next().toUpperCase()
    else if (w === '-H' || w === '--header') {
      const h = next()
      const colon = h.indexOf(':')
      if (colon <= 0) continue
      const key = h.slice(0, colon).trim()
      const value = h.slice(colon + 1).trim()
      if (credential(key, value)) leave(leftOut, key)
      else headers.push({ key, value })
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'].includes(w))
      data.push(next())
    else if (w === '--data-urlencode') encoded.push(next())
    else if (w === '-u' || w === '--user') {
      next()
      leave(leftOut, 'the user and password of -u')
    } else if (w === '-b' || w === '--cookie') {
      next()
      leave(leftOut, 'Cookie')
    } else if (w === '-A' || w === '--user-agent')
      headers.push({ key: 'User-Agent', value: next() })
    else if (w === '-e' || w === '--referer') headers.push({ key: 'Referer', value: next() })
    else if (w === '-G' || w === '--get') get = true
    else if (w === '--url') address = next()
    else if (IGNORED.has(w)) next()
    else if (NO_VALUE.has(w) || w.startsWith('-')) continue
    else if (!address) address = w
  }
  if (!address) throw new Error('This curl line has no address')
  const { url, params } = splitQuery(address)
  const pairs = encoded.map((e) => {
    const eq = e.indexOf('=')
    return eq < 0 ? { key: e, value: '' } : { key: e.slice(0, eq), value: e.slice(eq + 1) }
  })
  let body = data.join('&')
  if (get) {
    params.push(...splitQuery(`?${body}`).params, ...pairs)
    body = ''
  } else if (pairs.length)
    body = [
      body,
      ...pairs.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`),
    ]
      .filter(Boolean)
      .join('&')
  const m = method ?? (body ? 'POST' : 'GET')
  let name = url
  try {
    name = `${m} ${new URL(url).pathname}`
  } catch {
    // Not an address to read a path from: the name is what was written.
  }
  return {
    collection: 'Imported',
    requests: [
      {
        doc: request({
          name,
          method: isMethod(m) ? m : 'GET',
          url,
          params,
          headers,
          ...(body ? { body: { format: bodyFormat(headers, body), text: body } } : {}),
        }),
      },
    ],
    vars: [],
    leftOut,
  }
}
