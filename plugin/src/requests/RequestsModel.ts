// The saved requests of one project on one node: what the Requests view and a request's tab draw,
// and the moves they make. No Obsidian here: keys, scripts, the recording and remembered choices
// come in through ports, so sending is tested without the key store, a script or a debugger.
//
// A send goes the same way from a person and from an agent: the environment's values are put in,
// the script before runs on the request with keys still by name, the keys go in last, the node
// sends and is followed until the answer is in, then the script after reads the answer and the
// checks are read. Secrets of the environment (a token from an answer) live only in memory here.
import { reactive } from 'vue'
import { credential, SECRET_NAME, scrubSecrets, literalSecretParts } from './importers/shared'
import { FileCollections } from './FileCollections'
import type { HttpOutcome, HttpSend } from '@/components/debugger/http/types'
import {
  evaluateChecks,
  fill,
  missingVars,
  outgoing,
  varsOf,
  whyBlocked,
  type Outgoing,
} from './resolve'
import {
  collectionOf,
  followSend,
  originOf,
  outcomeOf,
  reasonOf,
  requestIdFor,
  sentAtWords,
} from './shapes'
import type { RequestsPorts, SendOptions } from './ports'
import { HeldSecrets } from './secrets'
import { answerOf, wholeBody } from './history'
import { untilAborted } from './lifetime'
export { forgetRequestSecrets, outcomeOf, requestIdFor, sentAtWords } from './shapes'
export type { RequestScriptInput, RequestScriptResult, RequestsPorts, SendOptions } from './ports'
import type { EnvironmentDoc, HttpRpc, RequestDoc, RequestList, SendSummary } from './wire'

export interface RequestEntry {
  doc?: RequestDoc
  error?: string
  history: HttpSend[]
  /** The answer shown: the latest, or the one of `shown`. */
  outcome?: HttpOutcome
  shown?: string
  compare?: HttpSend
  /** Sends that went into a recording: their run and step. */
  runs: Map<string, { runId: string; step?: string }>
}

const SAVE_AFTER_MS = 400
export class RequestsModel {
  readonly files?: FileCollections
  private stopFiles?: () => void
  private fileFollowers = 0
  private fileWatchEpoch = 0
  readonly state = reactive<{
    loading: boolean
    error: string
    folder: string
    collections: RequestList['collections']
    environments: string[]
    environment?: string
    env?: EnvironmentDoc
    /** Requests being sent now. */
    sending: string[]
    /** Sends go into the recording while one goes on. */
    intoRecording: boolean
    timeouts: Record<string, number>
    entries: Record<string, RequestEntry>
  }>({
    loading: false,
    error: '',
    folder: '',
    collections: [],
    environments: [],
    sending: [],
    intoRecording: true,
    timeouts: {},
    entries: {},
  })
  private readonly saves = new Map<string, { timer: number; work?: Promise<void> }>()
  /** A new send or answer selection supersedes reads already in flight. */
  private readonly answerReads = new Map<string, symbol>()
  private readonly wait: (ms: number) => Promise<void>
  private readonly held: HeldSecrets

  constructor(
    readonly rpc: HttpRpc,
    readonly projectId: string,
    private readonly ports: RequestsPorts
  ) {
    this.wait = ports.wait ?? ((ms) => new Promise((r) => window.setTimeout(r, ms)))
    this.held = new HeldSecrets(projectId)
    if (ports.files) this.files = new FileCollections(ports.files)
  }

  entry(id: string): RequestEntry {
    return (this.state.entries[id] ??= { history: [], runs: new Map() })
  }

  /** Invocation-local cancellation; the view and concurrent tools keep their own lifetimes. */
  forAgent(signal: AbortSignal, guard: () => void, onSend?: (id: string) => void): RequestsModel {
    const check = () => {
      signal.throwIfAborted()
      guard()
    }
    const rpc = new Proxy(this.rpc, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          check()
          return untilAborted(Promise.resolve(value.apply(target, args)), signal).then(
            (result: unknown) => {
              if (
                key === 'send' &&
                result &&
                typeof result === 'object' &&
                'send_id' in result &&
                typeof result.send_id === 'string'
              )
                onSend?.(result.send_id)
              return result
            }
          )
        }
      },
    })
    const wait = this.wait
    return new Proxy(this, {
      get(target, key, receiver) {
        if (key === 'rpc') return rpc
        if (key === 'wait') return (ms: number) => untilAborted(wait(ms), signal)
        const value: unknown = Reflect.get(target, key, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          check()
          return value.apply(receiver, args)
        }
      },
    })
  }

  timeout(id: string): number {
    const stored = this.state.timeouts[id] ?? Number(this.ports.prefs.get(`timeout:${id}`))
    return Number.isInteger(stored) && stored >= 1000 && stored <= 300000 ? stored : 300000
  }

  setTimeout(id: string, ms: number) {
    if (!Number.isInteger(ms) || ms < 1000 || ms > 300000)
      throw new Error('Choose a wait between 1 and 300 seconds')
    this.state.timeouts[id] = ms
    this.ports.prefs.set(`timeout:${id}`, String(ms))
  }

  // ── The list and the environment ──

  async load() {
    this.state.loading = true
    try {
      await this.refreshFiles()
      const list = await this.rpc.list(this.projectId)
      this.state.folder = list.folder
      this.state.collections = this.collectionsWithEdits(list.collections)
      this.state.environments = [
        ...list.environments,
        ...(this.files?.environments.map((e) => e.id) ?? []),
      ]
      this.state.error = ''
      const remembered = this.ports.prefs.get('environment')
      const pick =
        this.state.environment && this.state.environments.includes(this.state.environment)
          ? this.state.environment
          : remembered && this.state.environments.includes(remembered)
            ? remembered
            : this.state.environments[0]
      if (pick !== this.state.environment || !this.state.env) await this.readEnvironment(pick)
    } catch (e) {
      console.debug('[requests] List unavailable', e)
      this.state.error = reasonOf(e)
      throw e
    } finally {
      this.state.loading = false
    }
  }

  private async readEnvironment(name: string | undefined) {
    this.state.environment = name
    this.state.env = name
      ? (this.files?.environments.find((e) => e.id === name)?.doc ??
        (await this.rpc.environment(this.projectId, name)))
      : undefined
  }

  async selectEnvironment(name: string) {
    await this.readEnvironment(name)
    this.ports.prefs.set('environment', name)
  }

  async createEnvironment(name: string, base?: string) {
    const env = await this.rpc.saveEnvironment(this.projectId, {
      name,
      vars: base ? [{ key: 'base', value: base }] : [],
    })
    this.state.environments = [...new Set([...this.state.environments, env.name])].sort()
    await this.selectEnvironment(env.name)
  }

  async saveEnvironment(env: EnvironmentDoc) {
    if (this.files?.wasEnvironment(env.name)) {
      const saved = await this.files.saveEnvironment(env)
      if (env.name === this.state.environment) this.state.env = saved
      return saved
    }
    // A secret's value never leaves memory: what was typed for it is kept here, not written.
    this.held.remember(env)
    const saved = await this.rpc.saveEnvironment(this.projectId, {
      ...env,
      vars: env.vars.map(({ value, ...v }) => (v.secret ? v : { ...v, value: value ?? '' })),
    })
    if (env.name === this.state.environment) this.state.env = saved
    if (!this.state.environments.includes(env.name)) this.state.environments.push(env.name)
    return saved
  }

  async removeEnvironment(name: string) {
    await this.rpc.removeEnvironment(this.projectId, name)
    this.held.forget(name)
    this.state.environments = this.state.environments.filter((e) => e !== name)
    if (this.state.environment === name) await this.readEnvironment(this.state.environments[0])
  }

  /** The secret values of the environment in use, held in memory. */
  secrets(): Record<string, string> {
    return this.state.environment ? this.held.values(this.state.environment) : {}
  }
  /** Holds a secret for the environment in use; with an origin, it goes only there. */
  setSecret(key: string, value: string, origin?: string) {
    if (this.state.environment) this.held.set(this.state.environment, key, value, origin)
  }

  /** Where a request goes, with the environment's plain values put in. */
  private targetOf(doc: RequestDoc) {
    return originOf(fill(doc.url, varsOf(this.state.env, {})))
  }

  /** The values the environment in use puts into this request: a secret only for its origin,
   * see `HeldSecrets`. Without a request, none of the secrets. */
  vars(doc?: RequestDoc, person = false): Record<string, string> {
    const id = doc
      ? Object.keys(this.state.entries).find((id) => this.entry(id).doc === doc)
      : undefined
    const captures = id ? (this.files?.values(id) ?? {}) : {}
    if (!doc || !this.state.environment) return { ...varsOf(this.state.env, {}), ...captures }
    const to = this.targetOf(doc)
    return {
      ...varsOf(this.state.env, this.held.forTarget(this.state.environment, to, person)),
      ...captures,
    }
  }

  // ── A request ──

  async open(id: string) {
    const entry = this.entry(id)
    try {
      if (id.startsWith('file:')) {
        await this.refreshFiles()
        const file = this.files?.get(id)
        if (!file) throw new Error('The request file is gone')
        entry.doc = file.doc
        entry.error = undefined
        const answer = this.ports.prefs.get(`answer:${id}`)
        if (!entry.outcome && answer)
          await this.showSend(id, answer).catch((e) =>
            console.debug('[requests] Retained file answer unavailable', e)
          )
        return
      }
      entry.doc = await this.rpc.get(this.projectId, id)
      entry.error = undefined
      await this.readHistory(id)
    } catch (e) {
      entry.error = reasonOf(e)
      throw e
    }
  }

  private async readHistory(id: string, restore = true) {
    const entry = this.entry(id)
    const selection = this.answerReads.get(id)
    const sends = await this.rpc.history(this.projectId, id)
    if (this.answerReads.get(id) !== selection) return
    entry.history = sends.map((s) => this.sendView(id, s))
    // A request opened later shows its last answer, as it was left.
    if (restore && !entry.outcome && sends[0]) await this.showSend(id, sends[0].id).catch(() => {})
  }

  private sendView(id: string, s: SendSummary): HttpSend {
    if (s.run) this.entry(id).runs.set(s.id, { runId: s.run.run_id, step: s.run.step })
    return {
      id: s.id,
      at: sentAtWords(s.at),
      environment: s.environment ?? '',
      ...(s.status !== undefined ? { status: s.status } : {}),
      ...(s.failed || s.unknown ? { failed: true } : {}),
      ...(s.ms !== undefined ? { ms: s.ms } : {}),
      ...(s.bytes !== undefined ? { bytes: s.bytes } : {}),
      ...(s.run ? { intoRun: true } : {}),
    }
  }

  /** Edits are written once typing settles; the tab shows them at once. */
  change(id: string, doc: RequestDoc) {
    const entry = this.entry(id)
    if (JSON.stringify(entry.doc) !== JSON.stringify(doc) && !this.state.sending.includes(id)) {
      this.answerReads.set(id, Symbol())
      entry.outcome = undefined
      entry.shown = undefined
      entry.compare = undefined
    }
    this.files?.beginEdit(id)
    entry.error = undefined
    entry.doc = doc
    for (const collection of this.state.collections) {
      const row = collection.requests.find((r) => r.id === id)
      if (row) Object.assign(row, { name: doc.name, method: doc.method, url: doc.url })
    }
    const pending = this.saves.get(id)
    if (pending) window.clearTimeout(pending.timer)
    const save = { timer: 0 } as { timer: number; work?: Promise<void> }
    save.timer = window.setTimeout(() => {
      save.work = this.saveDoc(id, doc)
        .catch((e) => {
          console.debug('[requests] Request not written', e)
          this.entry(id).error = `Not saved: ${reasonOf(e)}`
        })
        .finally(() => {
          if (this.saves.get(id) === save) this.saves.delete(id)
        })
    }, SAVE_AFTER_MS)
    this.saves.set(id, save)
  }

  /** Writes an edit still waiting, now. */
  async flush(id: string) {
    const pending = this.saves.get(id)
    if (!pending) {
      if (id.startsWith('file:') && this.entry(id).error) throw new Error(this.entry(id).error)
      return
    }
    if (pending.work === undefined) {
      window.clearTimeout(pending.timer)
      this.saves.delete(id)
      const doc = this.entry(id).doc
      if (doc) await this.saveDoc(id, doc)
      return
    }
    await pending.work
    if (id.startsWith('file:') && this.entry(id).error) throw new Error(this.entry(id).error)
  }

  private async saveDoc(id: string, doc: RequestDoc) {
    try {
      if (id.startsWith('file:') && this.files) await this.files.save(id, doc)
      else await this.rpc.save(this.projectId, id, doc)
      this.entry(id).error = undefined
    } catch (error) {
      this.entry(id).error = `Not saved: ${reasonOf(error)}`
      throw error
    }
  }

  async refreshFiles() {
    if (!this.files) return
    const previousEnvironments = new Set(this.files.environments.map((e) => e.id))
    await this.files.refresh()
    for (const id of this.files.takeResolvedEdits()) {
      const pending = this.saves.get(id)
      if (pending && pending.work === undefined) {
        window.clearTimeout(pending.timer)
        this.saves.delete(id)
      }
    }
    this.state.environments = [
      ...this.state.environments.filter((name) => !previousEnvironments.has(name)),
      ...this.files.environments.map((e) => e.id),
    ]
    if (this.state.environment && previousEnvironments.has(this.state.environment))
      this.state.env = this.files.environments.find((e) => e.id === this.state.environment)?.doc
    for (const file of Object.values(this.files.state.entries)) {
      const entry = this.state.entries[file.id]
      if (entry && !this.saves.has(file.id) && !this.files.isEditing(file.id) && !file.gone) {
        entry.doc = file.doc
        entry.error = undefined
      }
    }
  }

  followFiles(): () => void {
    this.fileFollowers++
    if (this.fileFollowers === 1 && this.files) {
      const epoch = ++this.fileWatchEpoch
      void this.files.port
        .watch(() => {
          void this.refreshFiles().catch((e) => console.debug('[requests] Files unavailable', e))
        })
        .then((stop) => {
          if (this.fileFollowers && epoch === this.fileWatchEpoch) this.stopFiles = stop
          else stop()
        })
        .catch((e) => console.debug('[requests] File watch unavailable', e))
    }
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      this.fileFollowers = Math.max(0, this.fileFollowers - 1)
      if (this.fileFollowers === 0) {
        this.fileWatchEpoch++
        this.stopFiles?.()
        this.stopFiles = undefined
      }
    }
  }

  destroy() {
    this.fileFollowers = 0
    this.fileWatchEpoch++
    this.stopFiles?.()
    this.stopFiles = undefined
    for (const save of this.saves.values()) window.clearTimeout(save.timer)
  }

  async sendAll(path: string, options: SendOptions) {
    const collection = this.files?.collections.find((c) => c.file.path === path)
    for (const request of collection?.requests ?? []) {
      if (options.signal?.aborted) break
      const outcome = await this.send(request.id, options)
      if (
        outcome.kind !== 'answered' ||
        outcome.response.status >= 400 ||
        outcome.response.checks?.some((c) => c.passed === false)
      )
        break
    }
  }

  private async refreshList() {
    const list = await this.rpc.list(this.projectId)
    this.state.collections = this.collectionsWithEdits(list.collections)
    this.state.environments = [
      ...list.environments,
      ...(this.files?.environments.map((e) => e.id) ?? []),
    ]
  }

  /** Files can arrive from outside this client; follow only while the Requests view is open. */
  followList(online: () => boolean): () => void {
    const stopFiles = this.followFiles()
    let stopped = false
    let timer: number | undefined
    const schedule = (): void => {
      if (!stopped) timer = window.setTimeout((): void => void refresh(), 5000)
    }
    const refresh = async (): Promise<void> => {
      try {
        if (online() && !this.state.loading) await this.refreshList()
      } catch (error) {
        console.debug('[requests] External changes unavailable', error)
      } finally {
        schedule()
      }
    }
    schedule()
    return () => {
      stopped = true
      stopFiles()
      window.clearTimeout(timer)
    }
  }

  private collectionsWithEdits(collections: RequestList['collections']) {
    return collections.map((collection) => ({
      ...collection,
      requests: collection.requests.map((row) => {
        const doc = this.saves.has(row.id) ? this.state.entries[row.id]?.doc : undefined
        return doc ? { ...row, name: doc.name, method: doc.method, url: doc.url } : row
      }),
    }))
  }

  async createCollection(name: string) {
    await this.rpc.createCollection(this.projectId, name)
    await this.refreshList()
  }

  async create(collection: string, name: string, doc?: Partial<RequestDoc>, refresh = true) {
    const id = requestIdFor(collection, name)
    await this.rpc.save(
      this.projectId,
      id,
      {
        name,
        method: 'GET',
        url: '{{base}}/',
        params: [],
        headers: [],
        scripts: {},
        checks: [],
        ...doc,
      },
      { create: true }
    )
    if (refresh) await this.refreshList()
    return id
  }

  async duplicate(id: string) {
    await this.flush(id)
    if (id.startsWith('file:') && !this.entry(id).doc) await this.open(id)
    const original = this.entry(id).doc ?? (await this.rpc.get(this.projectId, id))
    const doc = id.startsWith('file:')
      ? scrubSecrets({
          collection: '',
          requests: [
            {
              doc: {
                ...original,
                headers: original.headers.filter((h) => !credential(h.key, h.value)),
              },
            },
          ],
          vars: [],
          leftOut: [],
        }).requests[0].doc
      : original
    const taken = new Set(this.state.collections.flatMap((c) => c.requests.map((r) => r.id)))
    let name = `${doc.name} copy`
    const destination = id.startsWith('file:') ? '' : collectionOf(id)
    for (let n = 2; taken.has(requestIdFor(destination, name)); n++) name = `${doc.name} copy ${n}`
    return this.create(destination, name, { ...doc, name })
  }

  async rename(id: string, name: string) {
    await this.flush(id)
    const doc = { ...(this.entry(id).doc ?? (await this.rpc.get(this.projectId, id))), name }
    const to = requestIdFor(collectionOf(id), name)
    await this.rpc.save(this.projectId, to, doc, to === id ? {} : { from: id })
    if (to !== id) {
      this.state.entries[to] = { ...this.entry(id), doc }
      delete this.state.entries[id]
    } else this.entry(id).doc = doc
    await this.refreshList()
    return to
  }

  async remove(id: string) {
    const pending = this.saves.get(id)
    if (pending) window.clearTimeout(pending.timer)
    this.saves.delete(id)
    await this.rpc.remove(this.projectId, id)
    delete this.state.entries[id]
    await this.refreshList()
  }

  /** The request as it would go now, keys and secrets by name: for the curl line and the
   * agent's card, so neither puts a value anywhere. */
  async prepared(id: string): Promise<Outgoing> {
    if (!this.entry(id).doc && id.startsWith('file:')) await this.open(id)
    const doc = this.entry(id).doc ?? (await this.rpc.get(this.projectId, id))
    return outgoing(doc, this.vars(doc))
  }

  /** Why it cannot go as it is, in words; nothing when it can. */
  blocked(doc: RequestDoc, person = true): string | undefined {
    const vars = this.vars(doc, person)
    const why = this.state.environment
      ? this.held.why(this.state.environment, missingVars(doc, vars))
      : undefined
    if (why) return why
    return whyBlocked(doc, vars, this.state.environment, (name) => this.ports.keys.has(name))
  }

  /** Binds the secrets a person's send takes with no origin yet to where it goes. */
  private bindSecrets(doc: RequestDoc) {
    const to = this.targetOf(doc)
    if (to && this.state.environment)
      this.held.bind(this.state.environment, missingVars(doc, varsOf(this.state.env, {})), to)
  }

  // ── Sending ──

  async send(id: string, options: SendOptions): Promise<HttpOutcome> {
    await this.flush(id)
    const entry = this.entry(id)
    if (!entry.doc && id.startsWith('file:')) await this.open(id)
    const doc = (entry.doc ??= await this.rpc.get(this.projectId, id))
    const file = this.files?.get(id)
    if (file?.gone) throw new Error('The request file is gone')
    const missingCapture = this.files?.captures(id).find((c) => c.value === undefined)
    if (missingCapture) throw new Error(`Send ${missingCapture.from.name} first`)
    const why = this.blocked(doc, options.interactive)
    if (why) throw new Error(why)
    const environment = this.state.environment ?? ''
    this.state.sending = [...this.state.sending, id]
    this.answerReads.set(id, Symbol())
    entry.outcome = { kind: 'sending' }
    entry.shown = undefined
    entry.compare = undefined
    try {
      const vars = this.vars(doc, options.interactive)
      if (options.interactive) this.bindSecrets(doc)
      let out = outgoing(doc, vars)
      if (doc.scripts.before) {
        const r = await this.ports.scripts.run(
          doc.scripts.before,
          { environment, vars, request: out },
          options.interactive,
          options.signal
        )
        if (r?.vars) await this.keepVars(r.vars, originOf(out.url))
        if (r?.request) {
          const to = originOf(out.url)
          out = { ...out, ...r.request, headers: r.request.headers ?? out.headers }
          // What the person allowed is the request as written: an agent's send does not follow a
          // script to another address, where the secrets put in were not meant to go.
          if (!options.interactive && originOf(out.url) !== to)
            throw new Error(
              `The script ${doc.scripts.before} sends this request to another address; send it yourself`
            )
        }
      }
      const keyed = await this.ports.keys.prepare(out, options.interactive, options.signal)
      const recording =
        (options.intoRecording ?? this.state.intoRecording)
          ? await this.ports.recording(originOf(keyed.out.url))
          : undefined
      const into = recording
      if (file) this.files?.forget(id)
      const started = await this.rpc.send(this.projectId, {
        ...(!file ? { requestId: id } : {}),
        ...(environment ? { environment } : {}),
        method: keyed.out.method,
        timeoutMs: this.timeout(id),
        url: keyed.out.url,
        headers: Object.entries(keyed.out.headers).map(([key, value]) => ({ key, value })),
        ...(keyed.out.body !== undefined ? { body: keyed.out.body } : {}),
        secrets: [
          ...new Set([
            ...keyed.secrets,
            ...Object.values(this.secrets()).filter(Boolean),
            ...(this.files?.wasEnvironment(this.state.environment)
              ? (this.state.env?.vars ?? [])
                  .filter((v) => SECRET_NAME.test(v.key) && v.value)
                  .flatMap((v) => literalSecretParts(v.value!))
              : []),
            ...(file
              ? [
                  ...(this.files?.secretValues(id) ?? []),
                  ...doc.headers
                    .filter((h) => credential(h.key, h.value))
                    .map((h) => h.value.replace(/^(Bearer|Basic|Token)\s+/i, '')),
                ]
              : []),
          ]),
        ],
        ...(into
          ? {
              ...(recording.routeByDestination
                ? { routeByDestination: true }
                : { debugSessionId: recording.sessionId }),
              ...(recording.stepHeader || this.state.env?.step_header ? { stepHeader: true } : {}),
            }
          : {}),
      })
      if (file) this.ports.prefs.set(`answer:${id}`, started.send_id)
      const status = await followSend(
        this.rpc,
        this.projectId,
        started.send_id,
        this.wait,
        options.signal
      )
      let outcome = outcomeOf(status.outcome, status.code_steps)
      if (status.outcome.state === 'answered') {
        const response = status.outcome.response
        if (file) this.files?.capture(id, response)
        if (doc.scripts.after) {
          const r = await this.ports.scripts
            .run(
              doc.scripts.after,
              {
                environment,
                vars,
                request: out,
                response: {
                  status: response.status,
                  ms: response.ms,
                  headers: Object.fromEntries(response.headers.map((h) => [h.key, h.value])),
                  body: response.body,
                },
              },
              options.interactive,
              options.signal
            )
            .catch((e): undefined => {
              console.debug('[requests] Script after the answer failed', e)
              return undefined
            })
          if (r?.vars) await this.keepVars(r.vars, originOf(keyed.out.url))
        }
        if (outcome.kind === 'answered' && doc.checks.length)
          outcome = {
            ...outcome,
            response: { ...outcome.response, checks: evaluateChecks(doc.checks, response) },
          }
      }
      if (status.send.run)
        entry.runs.set(status.send.id, {
          runId: status.send.run.run_id,
          step: status.send.run.step,
        })
      if (file) entry.history.unshift(this.sendView(id, status.send))
      entry.outcome = JSON.stringify(entry.doc) === JSON.stringify(doc) ? outcome : undefined
      if (!file)
        await Promise.all([this.readHistory(id, false), this.refreshList()]).catch((e) =>
          console.debug('[requests] History not read again', e)
        )
      return outcome
    } catch (e) {
      entry.outcome = undefined
      throw e
    } finally {
      this.state.sending = this.state.sending.filter((s) => s !== id)
    }
  }

  /** Only values explicitly declared secret stay in memory. */
  private async keepVars(values: Record<string, string>, origin: string | undefined) {
    const env = this.state.env
    if (!env || !this.state.environment) return
    let changed = false
    const vars = env.vars.map((v) => ({ ...v }))
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string') continue
      const known = vars.find((v) => v.key === key)
      // Declared secrets go back only where the answer came from.
      if (!known) {
        vars.push({ key, value })
        changed = true
      } else if (known.secret) this.held.set(env.name, key, value, origin)
      else if (known.value !== value) {
        known.value = value
        changed = true
      }
    }
    if (changed) this.state.env = await this.saveEnvironment({ ...env, vars })
  }

  // ── History ──

  /** Shows the answer of an earlier send. */
  async showSend(id: string, sendId: string) {
    const entry = this.entry(id)
    const selection = Symbol()
    this.answerReads.set(id, selection)
    const outcome = await answerOf(this.rpc, this.projectId, sendId, entry.doc?.checks ?? [])
    if (this.answerReads.get(id) !== selection) return
    entry.outcome = outcome
    entry.shown = sendId
    if (id.startsWith('file:')) this.ports.prefs.set(`answer:${id}`, sendId)
    if (entry.compare?.id === sendId) entry.compare = undefined
  }

  /** Compares the answer shown with an earlier one; none stops comparing. */
  async compare(id: string, sendId: string | undefined) {
    const entry = this.entry(id)
    const send = sendId ? entry.history.find((h) => h.id === sendId) : undefined
    entry.compare = send
      ? { ...send, body: await wholeBody(this.rpc, this.projectId, send.id) }
      : undefined
  }
}
