import { reactive } from 'vue'
import type { HttpCapture } from '@/components/debugger/http/types'
import { SECRET_NAME } from './importers/shared'
import type { EnvironmentDoc, RequestDoc, WireResponse } from './wire'
import { parseRequestFile, replaceRequestBlock, type FileRequest, type FileProblem } from './files'

export interface RequestFilePort {
  list(): Promise<string[]>
  read(path: string): Promise<{ text: string; contentId: string | null }>
  write(path: string, base: { text: string; contentId: string | null }, text: string): Promise<void>
  conflict?(
    path: string,
    base: { text: string; contentId: string | null },
    text: string
  ): Promise<void>
  watch(changed: () => void): Promise<() => void>
}
export interface FileEnvironment {
  id: string
  name: string
  file: string
  doc: EnvironmentDoc
  locations: Record<string, string>
  exposed: { key: string; file: string }[]
}
export interface FileCollection {
  name: string
  file: { kind: 'http' | 'bruno'; path: string; folder?: string; problem?: FileProblem }
  requests: FileRequest[]
}
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const CAPTURE = /\{\{\s*([\w.-]+\.response\.(?:body|headers)\.[^}]+?)\s*\}\}/g

/** Session-only answers and live source snapshots; no copies in saved requests. */
export class FileCollections {
  readonly state = reactive<{
    collections: FileCollection[]
    entries: Record<string, FileRequest>
    environments: FileEnvironment[]
  }>({
    collections: [],
    entries: {},
    environments: [],
  })
  private readonly fileVars = new Map<string, Record<string, string>>()
  private readonly sources = new Map<string, { text: string; contentId: string | null }>()
  private readonly answers = reactive(
    new Map<string, { response: Pick<WireResponse, 'status' | 'body' | 'headers'>; at: string }>()
  )
  private readonly edits = new Map<
    string,
    { request: FileRequest; base: { text: string; contentId: string | null } }
  >()
  private refreshing?: Promise<void>
  private refreshAgain = false
  constructor(readonly port: RequestFilePort) {}
  get environments() {
    return this.state.environments
  }
  text(path: string) {
    return this.sources.get(path)?.text
  }
  isEditing(id: string) {
    return this.edits.has(id)
  }
  beginEdit(id: string) {
    const request = this.get(id)
    if (request && !this.edits.has(id))
      this.edits.set(id, {
        request: JSON.parse(JSON.stringify(request)),
        base: { ...this.sources.get(request.origin.file) },
      })
  }
  get collections() {
    return this.state.collections
  }
  get(id: string) {
    return this.state.entries[id]
  }
  refresh(): Promise<void> {
    this.refreshAgain = true
    return (this.refreshing ??= (async () => {
      do {
        this.refreshAgain = false
        await this.read()
      } while (this.refreshAgain)
    })().finally(() => {
      this.refreshing = undefined
    }))
  }
  private async read() {
    const paths = await this.port.list()
    const roots = paths.filter((p) => /(^|\/)bruno\.json$/.test(p)).map(folderOf)
    const found: FileCollection[] = []
    const entries: FileRequest[] = []
    for (const path of paths.filter(
      (p) =>
        /\.(http|rest)$/i.test(p) ||
        (/\.bru$/i.test(p) && roots.some((root) => !root || p.startsWith(`${root}/`)))
    )) {
      const source = await this.port.read(path)
      const parsed = parseRequestFile(path, source.text)
      this.fileVars.set(
        path,
        Object.fromEntries(
          parsed.vars.filter((v) => v.value !== undefined).map((v) => [v.key, v.value])
        )
      )
      for (const request of parsed.requests) {
        const old = this.get(request.id)
        if (old && JSON.stringify(old.doc) !== JSON.stringify(request.doc))
          this.answers.delete(request.id)
      }
      this.sources.set(path, source)
      entries.push(...parsed.requests)
      const root = /\.bru$/i.test(path)
        ? roots.filter((r) => !r || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
        : undefined
      const collectionPath = root === undefined ? path : `${root ? root + '/' : ''}bruno.json`
      let collection = found.find((c) => c.file.path === collectionPath)
      if (!collection) {
        collection = {
          name: root === undefined ? path.split('/').at(-1) : root.split('/').at(-1) || 'Bruno',
          file: {
            kind: root === undefined ? 'http' : 'bruno',
            path: collectionPath,
            folder: folderOf(collectionPath),
          },
          requests: [],
        }
        found.push(collection)
      }
      collection.requests.push(...parsed.requests)
      if (parsed.problems[0]) collection.file.problem ??= { ...parsed.problems[0], file: path }
    }
    const ids = new Set(entries.map((r) => r.id))
    for (const old of Object.values(this.state.entries))
      if (!ids.has(old.id)) {
        old.gone = true
        this.answers.delete(old.id)
      }
    for (const entry of entries) this.state.entries[entry.id] = entry
    for (const collection of found)
      if (collection.file.kind === 'bruno')
        collection.requests.sort(
          (a, b) =>
            (a.sequence ?? 0) - (b.sequence ?? 0) || a.origin.file.localeCompare(b.origin.file)
        )
    this.state.collections = found
    const environments: FileEnvironment[] = []
    for (const folder of new Set(entries.map((r) => folderOf(r.origin.file)))) {
      const values = new Map<string, FileEnvironment>()
      for (const filename of ['http-client.env.json', 'http-client.private.env.json']) {
        const path = `${folder ? folder + '/' : ''}${filename}`
        if (!paths.includes(path)) continue
        const source = await this.port.read(path)
        const data: unknown = JSON.parse(source.text)
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error(`Invalid environment file: ${path}`)
        this.sources.set(path, source)
        for (const [name, vars] of Object.entries(data)) {
          if (!vars || typeof vars !== 'object' || Array.isArray(vars)) continue
          let environment = values.get(name)
          if (!environment) {
            const id = `${folder ? folder + '/' : ''}http-client.env.json · ${name}`
            environment = {
              id,
              name,
              file: path,
              doc: { name: id, vars: [] },
              locations: {},
              exposed: [],
            }
            values.set(name, environment)
          }
          for (const [key, value] of Object.entries(vars)) {
            if (
              typeof value !== 'string' &&
              typeof value !== 'number' &&
              typeof value !== 'boolean'
            )
              continue
            if (
              SECRET_NAME.test(key) &&
              String(value) &&
              !/^\$\{abele_key:[^}]+\}$/.test(String(value))
            )
              environment.exposed.push({ key, file: path })
            environment.doc.vars = environment.doc.vars.filter((v) => v.key !== key)
            environment.doc.vars.push({ key, value: String(value) })
            environment.locations[key] = path
          }
        }
      }
      environments.push(...values.values())
    }
    this.state.environments = environments
  }
  secretValues(id: string) {
    const vars = this.fileVars.get(this.get(id)?.origin.file ?? '') ?? {}
    return Object.entries(vars)
      .filter(
        ([name, value]) => SECRET_NAME.test(name) && value && !/\{\{|\$\{abele_key:/.test(value)
      )
      .map(([, value]) => value)
  }
  forget(id: string) {
    this.answers.delete(id)
  }
  capture(id: string, response: Pick<WireResponse, 'status' | 'body' | 'headers'>) {
    this.answers.set(id, { response, at: new Date().toISOString() })
  }
  captures(id: string): HttpCapture[] {
    const request = this.get(id)
    if (!request) return []
    const collection = this.collections.find((c) => c.requests.some((r) => r.id === id))
    const vars = this.fileVars.get(request.origin.file) ?? {}
    const texts = [JSON.stringify(request.doc)]
    const visited = new Set<string>()
    for (let at = 0; at < texts.length; at++) {
      for (const match of texts[at].matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
        const name = match[1]
        if (Object.hasOwn(vars, name) && !visited.has(name)) {
          visited.add(name)
          texts.push(vars[name])
        }
      }
    }
    const expressions = [
      ...new Set(texts.flatMap((text) => [...text.matchAll(CAPTURE)].map((m) => m[1]))),
    ]
    return expressions.map((expression) => {
      const match = /^(.*?)\.response\.(body|headers)\.(.*)$/.exec(expression)
      const from = collection?.requests.find((r) => r.captureName === match[1])
      const answer = from ? this.answers.get(from.id) : undefined
      let value: unknown
      if (answer) {
        if (match[2] === 'headers')
          value = answer.response.headers.find(
            (h) => h.key.toLowerCase() === match[3].toLowerCase()
          )?.value
        else {
          try {
            value = JSON.parse(answer.response.body)
            const path = match[3].replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1')
            for (const key of path.split('.').filter(Boolean))
              value =
                value && typeof value === 'object' && Object.hasOwn(value, key)
                  ? (value as Record<string, unknown>)[key]
                  : undefined
          } catch {
            value = undefined
          }
        }
      }
      return {
        expression,
        name: match[3].split('.').at(-1),
        from: { id: from?.id ?? '', name: from?.doc.name ?? match[1] },
        ...(value !== undefined
          ? { value: typeof value === 'string' ? value : JSON.stringify(value) }
          : {}),
        ...(answer ? { at: answer.at, status: answer.response.status } : {}),
      }
    })
  }
  values(id: string) {
    const vars = this.fileVars.get(this.get(id)?.origin.file ?? '') ?? {}
    const captures = Object.fromEntries(
      this.captures(id).flatMap((c) => (c.value === undefined ? [] : [[c.expression, c.value]]))
    )
    const filled = Object.fromEntries(
      Object.entries(vars).map(([key, value]) => [
        key,
        value.replace(CAPTURE, (whole, expression: string) => captures[expression] ?? whole),
      ])
    )
    return { ...filled, ...captures }
  }
  async save(id: string, doc: RequestDoc) {
    const edit = this.edits.get(id)
    const request = edit?.request ?? this.get(id)
    if (!request || this.get(id)?.gone) throw new Error('The request file is gone')
    const base = edit?.base ?? this.sources.get(request.origin.file)
    const current = await this.port.read(request.origin.file)
    const text = replaceRequestBlock(base.text, request, doc)
    if (current.contentId !== base.contentId || current.text !== base.text) {
      await this.port.conflict?.(request.origin.file, base, text)
      throw new Error('The request file changed; open the file to review the conflict')
    }
    await this.port.write(request.origin.file, base, text)
    this.edits.delete(id)
    await this.refresh()
  }
  async saveEnvironment(doc: EnvironmentDoc) {
    const environment = this.environments.find((e) => e.id === doc.name)
    if (!environment) throw new Error('The environment file is gone')
    if (
      environment.exposed.length ||
      doc.vars.some(
        (v) =>
          v.secret ||
          (SECRET_NAME.test(v.key) && v.value && !/^\$\{abele_key:[^}]+\}$/.test(v.value))
      )
    )
      throw new Error('Move secrets to keys before saving this file')
    const paths = new Set(Object.values(environment.locations))
    if (!paths.size) paths.add(environment.file)
    for (const path of paths) {
      const base = this.sources.get(path)
      const current = await this.port.read(path)
      if (current.contentId !== base.contentId || current.text !== base.text)
        throw new Error('The environment file changed; open it to review the conflict')
      const data = JSON.parse(base.text)
      const values = { ...data[environment.name] }
      for (const key of Object.keys(values))
        if (!doc.vars.some((v) => v.key === key)) delete values[key]
      for (const variable of doc.vars)
        if ((environment.locations[variable.key] ?? environment.file) === path)
          values[variable.key] = variable.value ?? ''
      data[environment.name] = values
      const text = JSON.stringify(data, null, 2) + '\n'
      await this.port.write(path, base, text)
    }
    await this.refresh()
    return this.environments.find((e) => e.id === doc.name).doc
  }
  async moveSecret(
    id: string,
    key: string,
    put: (key: string, value: string) => Promise<string>,
    sourcePath?: string
  ) {
    const environment = this.environments.find((e) => e.id === id)
    const path = sourcePath ?? environment?.locations[key]
    if (!environment || !path || !environment.exposed.some((e) => e.key === key && e.file === path))
      throw new Error('No exposed secret to move')
    const base = this.sources.get(path)!
    const data = JSON.parse(base.text)
    const value = String(data[environment.name][key])
    const current = await this.port.read(path)
    if (current.contentId !== base.contentId || current.text !== base.text)
      throw new Error('The environment file changed; open it to review the conflict')
    const name = await put(key, value)
    data[environment.name][key] = '${abele_key:' + name + '}'
    await this.port.write(path, base, JSON.stringify(data, null, 2) + '\n')
    await this.refresh()
  }
}
