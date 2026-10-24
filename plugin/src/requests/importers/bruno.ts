// A Bruno request (`.bru`): blocks `name { … }`, the method block with the address and the body's
// kind, `params:query`, `headers`, `body:*` and `assert`, which become checks.
import type { Pair } from '../wire'
import { credential, isMethod, leave, request, type Imported } from './shared'

function blocks(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^([\w:-]+)\s*\{\s*$/.exec(lines[i]!)
    if (!open) continue
    const body: string[] = []
    for (i++; i < lines.length && lines[i] !== '}'; i++) body.push(lines[i]!.replace(/^ {2}/, ''))
    out.set(open[1]!, body)
  }
  return out
}

function pairs(lines: string[] | undefined): Pair[] {
  return (lines ?? []).flatMap((l) => {
    const m = /^(~?)([^:]+):\s?(.*)$/.exec(l.trim())
    return m ? [{ key: m[2]!.trim(), value: m[3]!, ...(m[1] ? { off: true } : {}) }] : []
  })
}

const OPS: Record<string, string> = {
  eq: '==',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'contains',
}

export function importBruno(text: string, options: { source?: boolean } = {}): Imported {
  const b = blocks(text)
  const leftOut: string[] = []
  const verb = [...b.keys()].find((k) => isMethod(k.toUpperCase()))
  if (!verb) throw new Error('This Bruno file has no request in it')
  const http = pairs(b.get(verb))
  const field = (k: string) => http.find((p) => p.key === k)?.value.trim() ?? ''
  const headers: Pair[] = []
  for (const h of pairs(b.get('headers')))
    if (!options.source && credential(h.key, h.value)) leave(leftOut, h.key)
    else headers.push(h)
  const bearer = pairs(b.get('auth:bearer'))
    .find((p) => p.key === 'token')
    ?.value.trim()
  if (bearer)
    if (options.source || /\{\{/.test(bearer))
      headers.push({ key: 'Authorization', value: `Bearer ${bearer}` })
    else leave(leftOut, 'the token of auth:bearer')
  const kind = field('body')
  const raw = b.get(`body:${kind}`) ?? b.get('body:json') ?? b.get('body:text')
  const form = kind === 'form-urlencoded' ? pairs(b.get('body:form-urlencoded')) : undefined
  const bodyText = form
    ? form
        .filter((p) => !p.off)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&')
    : (raw ?? []).join('\n').trim()
  const checks = pairs(b.get('assert')).flatMap((a) => {
    const m = /^(\w+)\s+(.+)$/.exec(a.value.trim())
    const op = m && OPS[m[1]!]
    if (!m || !op || a.off) return []
    const subject = a.key.replace(/^res\./, '')
    return [`${subject} ${op} ${m[2]}`]
  })
  return {
    collection: 'Imported',
    requests: [
      {
        doc: request({
          name:
            pairs(b.get('meta'))
              .find((p) => p.key === 'name')
              ?.value.trim() || verb.toUpperCase(),
          method: verb.toUpperCase() as ReturnType<typeof request>['method'],
          url: field('url'),
          params: pairs(b.get('params:query')),
          headers,
          ...(bodyText
            ? {
                body: {
                  format: kind === 'json' ? 'json' : form ? 'form' : 'text',
                  text: bodyText,
                },
              }
            : {}),
          checks,
        }),
      },
    ],
    vars: [],
    leftOut,
  }
}
