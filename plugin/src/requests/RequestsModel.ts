// The saved requests of one project on one node: what the Requests view and a request's tab draw,
// and the moves they make. No Obsidian here: keys, scripts, the recording and remembered choices
// come in through ports, so sending is tested without the key store, a script or a debugger.
//
// A send goes the same way from a person and from an agent: the environment's values are put in,
// the script before runs on the request with keys still by name, the keys go in last, the node
// sends and is followed until the answer is in, then the script after reads the answer and the
// checks are read. Secrets of the environment (a token from an answer) live only in memory here.
import { reactive } from 'vue'
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
  SECRETS,
  collectionOf,
  followSend,
  originOf,
  outcomeOf,
  reasonOf,
  requestIdFor,
  sentAtWords,
} from './shapes'
import type { RequestsPorts, SendOptions } from './ports'
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
/** Of a body, what is read to show again or compare. */
const BODY_READ = 1024 * 1024
export class RequestsModel {
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
    entries: Record<string, RequestEntry>
  }>({
    loading: false,
    error: '',
    folder: '',
    collections: [],
    environments: [],
    sending: [],
    intoRecording: false,
    entries: {},
  })
  private readonly saves = new Map<string, { timer: number; work?: Promise<void> }>()
  private readonly wait: (ms: number) => Promise<void>

  constructor(
    readonly rpc: HttpRpc,
    readonly projectId: string,
    private readonly ports: RequestsPorts
  ) {
    this.wait = ports.wait ?? ((ms) => new Promise((r) => window.setTimeout(r, ms)))
  }

  entry(id: string): RequestEntry {
    return (this.state.entries[id] ??= { history: [], runs: new Map() })
  }

  // ── The list and the environment ──

  async load() {
    this.state.loading = true
    try {
      const list = await this.rpc.list(this.projectId)
      this.state.folder = list.folder
      this.state.collections = list.collections
      this.state.environments = list.environments
      this.state.error = ''
      const remembered = this.ports.prefs.get('environment')
      const pick =
        this.state.environment && list.environments.includes(this.state.environment)
          ? this.state.environment
          : remembered && list.environments.includes(remembered)
            ? remembered
            : list.environments[0]
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
    this.state.env = name ? await this.rpc.environment(this.projectId, name) : undefined
  }

  async selectEnvironment(name: string) {
    await this.readEnvironment(name)
    this.ports.prefs.set('environment', name)
  }

  async createEnvironment(name: string) {
    const env = await this.rpc.saveEnvironment(this.projectId, {
      name,
      vars: [{ key: 'base', value: 'http://localhost:3000' }],
    })
    this.state.environments = [...new Set([...this.state.environments, env.name])].sort()
    await this.selectEnvironment(env.name)
  }

  async saveEnvironment(env: EnvironmentDoc) {
    // A secret's value never leaves memory: what was typed for it is kept here, not written, and
    // goes only to the environment's own `base`, when it has one.
    const secrets = this.secretsOf(env.name)
    const base = env.vars.find((v) => v.key === 'base' && !v.secret)?.value
    for (const v of env.vars)
      if (v.secret && v.value !== undefined && secrets[v.key]?.value !== v.value)
        secrets[v.key] = { value: v.value, origin: base ? originOf(base) : undefined }
    for (const key of Object.keys(secrets))
      if (!env.vars.some((v) => v.secret && v.key === key)) delete secrets[key]
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
    SECRETS.delete(`${this.projectId}\n${name}`)
    this.state.environments = this.state.environments.filter((e) => e !== name)
    if (this.state.environment === name) await this.readEnvironment(this.state.environments[0])
  }

  private secretsOf(env: string) {
    const key = `${this.projectId}\n${env}`
    let s = SECRETS.get(key)
    if (!s) SECRETS.set(key, (s = {}))
    return s
  }
  /** The secret values of the environment in use, held in memory. */
  secrets(): Record<string, string> {
    if (!this.state.environment) return {}
    return Object.fromEntries(
      Object.entries(this.secretsOf(this.state.environment)).map(([k, h]) => [k, h.value])
    )
  }
  /** Holds a secret for the environment in use; with an origin, it goes only there. */
  setSecret(key: string, value: string, origin?: string) {
    if (this.state.environment)
      this.secretsOf(this.state.environment)[key] = { value, ...(origin ? { origin } : {}) }
  }

  /** The values the environment in use puts into this request: secrets only for their origin. */
  vars(doc?: RequestDoc): Record<string, string> {
    if (!doc || !this.state.environment) return varsOf(this.state.env, {})
    const to = originOf(fill(doc.url, varsOf(this.state.env, {})))
    const held = Object.entries(this.secretsOf(this.state.environment)).filter(
      ([, h]) => !h.origin || h.origin === to
    )
    return varsOf(this.state.env, Object.fromEntries(held.map(([k, h]) => [k, h.value])))
  }

  // ── A request ──

  async open(id: string) {
    const entry = this.entry(id)
    try {
      entry.doc = await this.rpc.get(this.projectId, id)
      entry.error = undefined
      await this.readHistory(id)
    } catch (e) {
      entry.error = reasonOf(e)
      throw e
    }
  }

  private async readHistory(id: string) {
    const entry = this.entry(id)
    const sends = await this.rpc.history(this.projectId, id)
    entry.history = sends.map((s) => this.sendView(id, s))
    // A request opened later shows its last answer, as it was left.
    if (!entry.outcome && sends[0]) await this.showSend(id, sends[0].id).catch(() => {})
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
    this.entry(id).doc = doc
    const pending = this.saves.get(id)
    if (pending) window.clearTimeout(pending.timer)
    const save = { timer: 0 } as { timer: number; work?: Promise<void> }
    save.timer = window.setTimeout(() => {
      save.work = this.rpc
        .save(this.projectId, id, doc)
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
    if (!pending) return
    if (pending.work === undefined) {
      window.clearTimeout(pending.timer)
      this.saves.delete(id)
      const doc = this.entry(id).doc
      if (doc) await this.rpc.save(this.projectId, id, doc)
      return
    }
    await pending.work
  }

  private async refreshList() {
    const list = await this.rpc.list(this.projectId)
    this.state.collections = list.collections
    this.state.environments = list.environments
  }

  async createCollection(name: string) {
    await this.rpc.createCollection(this.projectId, name)
    await this.refreshList()
  }

  async create(collection: string, name: string, doc?: Partial<RequestDoc>) {
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
    await this.refreshList()
    return id
  }

  async duplicate(id: string) {
    await this.flush(id)
    const doc = this.entry(id).doc ?? (await this.rpc.get(this.projectId, id))
    const taken = new Set(this.state.collections.flatMap((c) => c.requests.map((r) => r.id)))
    let name = `${doc.name} copy`
    for (let n = 2; taken.has(requestIdFor(collectionOf(id), name)); n++)
      name = `${doc.name} copy ${n}`
    return this.create(collectionOf(id), name, { ...doc, name })
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
    const doc = this.entry(id).doc ?? (await this.rpc.get(this.projectId, id))
    return outgoing(doc, this.vars())
  }

  /** Why it cannot go as it is, in words; nothing when it can. */
  blocked(doc: RequestDoc): string | undefined {
    const vars = this.vars(doc)
    const held = this.state.environment ? this.secretsOf(this.state.environment) : {}
    const elsewhere = missingVars(doc, vars).find((name) => held[name]?.origin)
    if (elsewhere)
      return `${elsewhere} is kept for ${held[elsewhere]!.origin} and is not sent anywhere else`
    return whyBlocked(doc, vars, this.state.environment, (name) => this.ports.keys.has(name))
  }

  // ── Sending ──

  async send(id: string, options: SendOptions): Promise<HttpOutcome> {
    await this.flush(id)
    const entry = this.entry(id)
    const doc = (entry.doc ??= await this.rpc.get(this.projectId, id))
    const why = this.blocked(doc)
    if (why) throw new Error(why)
    const environment = this.state.environment ?? ''
    this.state.sending = [...this.state.sending, id]
    entry.outcome = { kind: 'sending' }
    entry.shown = undefined
    entry.compare = undefined
    try {
      const vars = this.vars(doc)
      let out = outgoing(doc, vars)
      if (doc.scripts.before) {
        const r = await this.ports.scripts.run(
          doc.scripts.before,
          { environment, vars, request: out },
          options.interactive,
          options.signal
        )
        if (r?.vars) await this.keepVars(r.vars, originOf(out.url))
        if (r?.request) out = { ...out, ...r.request, headers: r.request.headers ?? out.headers }
      }
      const keyed = await this.ports.keys.prepare(out, options.interactive, options.signal)
      const recording = this.ports.recording()
      const into = (options.intoRecording ?? this.state.intoRecording) && recording
      const started = await this.rpc.send(this.projectId, {
        requestId: id,
        ...(environment ? { environment } : {}),
        method: keyed.out.method,
        url: keyed.out.url,
        headers: Object.entries(keyed.out.headers).map(([key, value]) => ({ key, value })),
        ...(keyed.out.body !== undefined ? { body: keyed.out.body } : {}),
        secrets: [...new Set([...keyed.secrets, ...Object.values(this.secrets()).filter(Boolean)])],
        ...(into
          ? {
              debugSessionId: recording.sessionId,
              ...(this.state.env?.step_header ? { stepHeader: true } : {}),
            }
          : {}),
      })
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
      entry.outcome = outcome
      await Promise.all([this.readHistory(id), this.refreshList()]).catch((e) =>
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

  /** Values a script hands back: a secret of the environment, or one it does not have, stays in
   * memory; a plain one the environment keeps is written. */
  private async keepVars(values: Record<string, string>, origin: string | undefined) {
    const env = this.state.env
    if (!env || !this.state.environment) return
    const secrets = this.secretsOf(env.name)
    let changed = false
    const vars = env.vars.map((v) => ({ ...v }))
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string') continue
      const known = vars.find((v) => v.key === key)
      // A token from an answer goes back only where it came from.
      const held = { value, ...(origin ? { origin } : {}) }
      if (!known) {
        vars.push({ key, secret: true })
        secrets[key] = held
        changed = true
      } else if (known.secret) secrets[key] = held
      else if (known.value !== value) {
        known.value = value
        changed = true
      }
    }
    if (changed) this.state.env = await this.rpc.saveEnvironment(this.projectId, { ...env, vars })
  }

  // ── History ──

  /** Shows the answer of an earlier send. */
  async showSend(id: string, sendId: string) {
    const entry = this.entry(id)
    const status = await this.rpc.status(this.projectId, sendId)
    let outcome = outcomeOf(status.outcome)
    if (outcome.kind === 'answered' && status.outcome.state === 'answered') {
      if (status.outcome.response.more)
        outcome = {
          ...outcome,
          response: { ...outcome.response, body: await this.wholeBody(sendId) },
        }
      if (entry.doc?.checks.length)
        outcome = {
          ...outcome,
          response: {
            ...outcome.response,
            checks: evaluateChecks(entry.doc.checks, {
              ...status.outcome.response,
              body: outcome.response.body,
            }),
          },
        }
    }
    entry.outcome = outcome
    entry.shown = sendId
    if (entry.compare?.id === sendId) entry.compare = undefined
  }

  /** Compares the answer shown with an earlier one; none stops comparing. */
  async compare(id: string, sendId: string | undefined) {
    const entry = this.entry(id)
    if (!sendId) {
      entry.compare = undefined
      return
    }
    const send = entry.history.find((h) => h.id === sendId)
    if (!send) return
    entry.compare = { ...send, body: await this.wholeBody(sendId) }
  }

  private async wholeBody(sendId: string) {
    let text = ''
    let from: number | undefined = 0
    while (from !== undefined && text.length < BODY_READ) {
      const page = await this.rpc.body(this.projectId, sendId, from)
      text += page.text
      from = page.next
    }
    return from === undefined ? text : `${text}\n… the rest is on the node`
  }
}
