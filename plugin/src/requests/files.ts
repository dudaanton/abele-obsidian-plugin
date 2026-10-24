import { importHttp } from './importers/http'
import { importBruno } from './importers/bruno'
import { credential, isMethod, scrubSecrets } from './importers/shared'
import { addressOf } from './resolve'
import type { EnvVar, RequestDoc } from './wire'

export interface FileRequest {
  id: string
  doc: RequestDoc
  origin: { file: string; line: number }
  sequence?: number
  captureName?: string
  script?: string
  start: number
  end: number
  gone?: boolean
}
export interface FileProblem {
  file?: string
  line: number
  text: string
}
export interface ParsedFile {
  requests: FileRequest[]
  problems: FileProblem[]
  vars: EnvVar[]
}

/** Source coordinates stay separate from the editable request document. */
export function parseRequestFile(file: string, text: string): ParsedFile {
  const lines = text.split(/\r\n|\n|\r/)
  const problems: FileProblem[] = []
  const requests: FileRequest[] = []
  const vars: EnvVar[] = []
  if (/\.bru$/i.test(file)) {
    try {
      const parsed = importBruno(text, { source: true })
      const line =
        lines.findIndex((l) => /^(get|post|put|patch|delete|head|options)\s*\{/i.test(l)) + 1
      requests.push({
        id: fileRequestId(file, 0),
        doc: parsed.requests[0].doc,
        origin: { file, line },
        sequence: Number(/^\s*seq:\s*(\d+)/m.exec(text)?.[1] ?? 0),
        start: 0,
        end: lines.length,
      })
      for (const name of parsed.leftOut)
        problems.push({ line, text: `Credential omitted: ${name}` })
    } catch (e) {
      problems.push({ line: 1, text: e instanceof Error ? e.message : String(e) })
    }
    return { requests, problems, vars }
  }
  const starts = [0, ...lines.flatMap((l, i) => (/^###/.test(l) ? [i + 1] : []))]
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]
    const end = index + 1 < starts.length ? starts[index + 1] - 1 : lines.length
    const block = lines.slice(start, end)
    let method = -1
    for (let i = 0; i < block.length; i++) {
      const line = block[i].trim()
      const variable = /^@([\w.-]+)\s*=\s*(.*)$/.exec(line)
      if (variable) {
        vars.push({ key: variable[1], value: variable[2] })
        continue
      }
      if (!line || /^(#|\/\/)/.test(line)) continue
      method = i
      break
    }
    if (method < 0) continue
    const first = block[method].trim().split(/\s+/)
    if (!isMethod(first[0].toUpperCase()) || !first[1]) {
      problems.push({ line: start + method + 1, text: 'Expected an HTTP method and address' })
      continue
    }
    for (let i = method + 1; i < block.length && block[i].trim(); i++) {
      if (!/^\s*(#|\/\/)/.test(block[i]) && block[i].indexOf(':') <= 0)
        problems.push({ line: start + i + 1, text: 'Expected a header name and colon' })
    }
    const scriptAt = block.findIndex((l) => /^\s*>\s*\{%/.test(l))
    const title = start > 0 ? lines[start - 1].replace(/^###\s*/, '') : ''
    const parsed = importHttp(
      [`### ${title}`, ...block.slice(0, scriptAt < 0 ? undefined : scriptAt)].join('\n'),
      { source: true }
    )
    const doc = parsed.requests[0]?.doc
    if (!doc) continue
    const captureName = block
      .map((l) => /^(?:#|\/\/)\s*@name\s+([\w.-]+)\s*$/.exec(l.trim())?.[1])
      .find(Boolean)
    requests.push({
      id: fileRequestId(file, captureName ? `name:${captureName}` : requests.length),
      doc,
      origin: { file, line: start + method + 1 },
      start,
      end,
      ...(captureName ? { captureName } : {}),
      ...(scriptAt >= 0 ? { script: block.slice(scriptAt).join('\n') } : {}),
    })
    for (const name of parsed.leftOut)
      problems.push({ line: start + method + 1, text: `Credential omitted: ${name}` })
  }
  return { requests, problems, vars }
}
export const fileRequestId = (file: string, block: number | string) =>
  `file:${encodeURIComponent(file)}:${block}`

/** Replace one block, leaving its neighbours and source-only script text intact. */
export function replaceRequestBlock(text: string, request: FileRequest, doc: RequestDoc): string {
  if (
    doc.headers.some(
      (h) =>
        credential(h.key, h.value) &&
        !request.doc.headers.some((old) => old.key === h.key && old.value === h.value)
    )
  )
    throw new Error('Use a key reference instead of writing a credential into the file')
  const scrubbed = scrubSecrets({ collection: '', requests: [{ doc }], vars: [], leftOut: [] })
    .requests[0].doc
  if (
    JSON.stringify(doc.body) !== JSON.stringify(request.doc.body) &&
    JSON.stringify(scrubbed.body) !== JSON.stringify(doc.body)
  )
    throw new Error('Use key references for secrets in the request body')
  if (
    doc.params.some(
      (p) =>
        scrubbed.params.some((q) => q.key === p.key && q.value !== p.value) &&
        !request.doc.params.some((old) => old.key === p.key && old.value === p.value)
    )
  )
    throw new Error('Use key references for secrets in the request address')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  if (/\.bru$/i.test(request.origin.file)) {
    const replace = (source: string, name: string, body: string) => {
      const pattern = new RegExp(`^${name}\\s*\\{[^]*?^\\}`, 'm')
      const block = `${name} {${newline}${body}${newline}}`
      return pattern.test(source)
        ? source.replace(pattern, () => block)
        : `${source}${newline}${block}${newline}`
    }
    let next = text.replace(
      /^(get|post|put|patch|delete|head|options)(\s*\{)/im,
      (_, _verb: string, brace: string) => doc.method.toLowerCase() + brace
    )
    const verb = doc.method.toLowerCase()
    const httpBlock = new RegExp(`^${verb}\\s*\\{([^]*?)^\\}`, 'm')
    next = next.replace(httpBlock, (whole: string) => {
      let block = whole
      if (doc.url !== request.doc.url)
        block = block.replace(/^(\s*url:\s*).*$/m, (_, prefix: string) => prefix + doc.url)
      if (JSON.stringify(doc.body) !== JSON.stringify(request.doc.body))
        block = block.replace(
          /^(\s*body:\s*).*$/m,
          (_, prefix: string) =>
            prefix +
            (doc.body?.format === 'form' ? 'form-urlencoded' : (doc.body?.format ?? 'none'))
        )
      return block
    })
    if (doc.name !== request.doc.name)
      next = next.replace(
        /^(meta\s*\{[^]*?^\s*name:\s*).*$/m,
        (_, prefix: string) => prefix + doc.name
      )
    const pairs = (rows: RequestDoc['headers']) =>
      rows.map((p) => `  ${p.off ? '~' : ''}${p.key}: ${p.value}`).join(newline)
    if (JSON.stringify(doc.params) !== JSON.stringify(request.doc.params))
      next = replace(next, 'params:query', pairs(doc.params))
    if (JSON.stringify(doc.headers) !== JSON.stringify(request.doc.headers))
      next = replace(next, 'headers', pairs(doc.headers))
    if (JSON.stringify(doc.body) !== JSON.stringify(request.doc.body)) {
      next = next.replace(/^body:[\w-]+\s*\{[^]*?^\}\r?\n?/gm, '')
      if (doc.body)
        next = replace(
          next,
          `body:${doc.body.format === 'form' ? 'form-urlencoded' : doc.body.format}`,
          doc.body.text
            .split('\n')
            .map((l) => `  ${l}`)
            .join(newline)
        )
    }
    if (JSON.stringify(doc.checks) !== JSON.stringify(request.doc.checks)) {
      const ops: Record<string, string> = {
        '==': 'eq',
        '!=': 'neq',
        '>': 'gt',
        '>=': 'gte',
        '<': 'lt',
        '<=': 'lte',
        contains: 'contains',
      }
      next = replace(
        next,
        'assert',
        doc.checks
          .map((check) => {
            const match = /^(\S+)\s+(==|!=|>=|<=|>|<|contains)\s+(.+)$/.exec(check)
            if (!match) throw new Error('This check cannot be written as a Bruno assertion')
            return `  res.${match[1]}: ${ops[match[2]]} ${match[3]}`
          })
          .join(newline)
      )
    }
    return next
  }
  const lines = text.split(/\r\n|\n|\r/)
  const block = lines.slice(request.start, request.end)
  const method = request.origin.line - request.start - 1
  const original = request.doc
  if (
    doc.method !== original.method ||
    doc.url !== original.url ||
    JSON.stringify(doc.params) !== JSON.stringify(original.params)
  )
    block[method] = `${doc.method} ${addressOf(doc, {})}`
  const blank = block.findIndex((line, index) => index > method && !line.trim())
  const bodyAt = blank < 0 ? block.length : blank + 1
  const scriptAt = block.findIndex((line) => /^\s*>\s*\{%/.test(line))
  if (JSON.stringify(doc.body) !== JSON.stringify(original.body)) {
    const end = scriptAt < 0 ? block.length : scriptAt
    block.splice(
      bodyAt,
      end - bodyAt,
      ...(doc.body ? doc.body.text.split('\n') : []),
      ...(end < block.length || lines[request.end] !== undefined ? [''] : [])
    )
    if (blank < 0 && doc.body) block.splice(bodyAt, 0, '')
  }
  if (JSON.stringify(doc.headers) !== JSON.stringify(original.headers)) {
    const end = blank < 0 ? method + 1 : blank
    const comments = block.slice(method + 1, end).filter((line) => /^\s*(#|\/\/)/.test(line))
    block.splice(
      method + 1,
      end - method - 1,
      ...comments,
      ...doc.headers.filter((p) => !p.off).map((p) => `${p.key}: ${p.value}`)
    )
  }
  if (doc.name !== original.name) {
    if (request.start > 0) lines[request.start - 1] = `### ${doc.name}`
    else block.unshift(`### ${doc.name}`)
  }
  if (JSON.stringify(doc.checks) !== JSON.stringify(original.checks)) {
    const methodLine = block.findIndex((l) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/.test(l))
    const prefix = block
      .slice(0, methodLine)
      .filter((l) => !/^(?:#|\/\/)\s*@check\s/.test(l.trim()))
    block.splice(0, methodLine, ...prefix, ...doc.checks.map((check) => `# @check ${check}`))
  }
  return [...lines.slice(0, request.start), ...block, ...lines.slice(request.end)].join(newline)
}
