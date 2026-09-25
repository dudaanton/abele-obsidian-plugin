/**
 * Who the people in a GitHub tab are: the name on each login's profile and their picture, looked
 * up once and kept for a week.
 *
 * The API names people by login everywhere; the profile's `name` is a request of its own. Those
 * requests are gathered for a moment and sent together — one GraphQL query for up to fifty
 * logins when there is a token, `/users/<login>` one by one without one (GraphQL refuses an
 * unsigned request), and never more than a handful of those, since an unsigned client has sixty
 * requests an hour for everything.
 *
 * Pictures are fetched as bytes and kept as `data:` URLs beside the names, so they show with no
 * network at all and from an Enterprise server whose avatars need the token (see
 * `GithubClient.image`).
 *
 * Everything lives in `github-users.json` in the plugin's folder, not in the settings: it is a
 * cache of other people's details, rebuilt at will, a few hundred kilobytes once pictures are in
 * it and rewritten as people are met — none of which belongs in a file that syncs between
 * devices, travels in a settings transfer and makes every other device reload when it changes.
 */
import { reactive, type InjectionKey } from 'vue'
import type { Plugin } from 'obsidian'
import { GithubError, type GithubClient } from './client'

/** How long a name or a picture is trusted before it is asked for again. */
export const USER_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A lookup that failed — a rate limit, no network — is not tried again for this long. */
const RETRY_MS = 10 * 60 * 1000
/** The picture's size in pixels: twice the size it is drawn at, for a sharp one on a phone. */
export const AVATAR_PX = 40
/** Logins asked about in one GraphQL query. */
const BATCH = 50
/** Profiles asked for one at a time, without a token, per gathering. */
const UNSIGNED_LOOKUPS = 10
/** People kept; past it the ones not met for longest go first. */
const MAX_PEOPLE = 2000
/** How long lookups are gathered before they are sent. */
const GATHER_MS = 30
const SAVE_MS = 2000

export interface GithubPerson {
  login: string
  /** The profile's name; null when the profile has none, or it could not be read. */
  name: string | null
  /** A picture to draw: a `data:` URL once fetched, the address before that; null without one. */
  avatar: string | null
}

interface Entry {
  login: string
  name: string | null
  /** When the name was read; absent while it has not been. */
  at?: number
  /** Where the picture is. */
  avatarUrl?: string
  /** The picture itself, as a `data:` URL. */
  avatar?: string
  avatarAt?: number
  /** When this person was last shown, for evicting the ones nobody looks at. */
  seen: number
}

interface Stored {
  version: 1
  people: Record<string, Entry>
}

export interface UserStorage {
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

/** A picture's address at the size it is drawn at. */
export function sizedAvatar(url: string, px = AVATAR_PX): string {
  try {
    const u = new URL(url)
    u.searchParams.set('s', String(px))
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Logins with no profile to ask for: apps (`name[bot]`), which GraphQL's `user` does not find,
 * and `ghost`, which stands for a deleted account.
 */
const noProfile = (login: string) => /\[bot\]$/i.test(login) || login === 'ghost'

const keyOf = (host: string, login: string) => `${host}\n${login.toLowerCase()}`

interface Gathering {
  client: GithubClient
  logins: Set<string>
  timer: number | null
  waiting: (() => void)[]
}

const USERS_QUERY = (n: number) => {
  const vars = Array.from({ length: n }, (_, i) => `$l${i}: String!`).join(', ')
  const fields = Array.from(
    { length: n },
    (_, i) => `u${i}: user(login: $l${i}) { login name avatarUrl(size: ${AVATAR_PX}) }`
  ).join('\n  ')
  return `query(${vars}) {\n  ${fields}\n}`
}

export class GithubUsers {
  private readonly people = reactive(new Map<string, Entry>())
  private readonly failed = new Map<string, number>()
  private readonly gatherings = new Map<string, Gathering>()
  private readonly loaded: Promise<void>
  private saveTimer: number | null = null

  constructor(
    private readonly storage: UserStorage | null = null,
    private readonly now: () => number = () => Date.now()
  ) {
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    if (!this.storage) return
    try {
      const text = await this.storage.read()
      if (!text) return
      const stored = JSON.parse(text) as Stored
      if (stored?.version !== 1 || typeof stored.people !== 'object') return
      for (const [key, entry] of Object.entries(stored.people)) {
        if (!this.people.has(key)) this.people.set(key, entry)
      }
    } catch (e) {
      console.warn('[Abele] the GitHub people cache could not be read; starting afresh', e)
    }
  }

  /** Waits for the cache on disk to be read — for a test, and for the tools. */
  ready(): Promise<void> {
    return this.loaded
  }

  /** How many people are kept. */
  get size(): number {
    return this.people.size
  }

  /**
   * A person as far as they are known now — reactive, so a view that reads this redraws when the
   * lookup comes back. `avatarUrl` is the picture an API answer named, used until one is kept.
   */
  person(host: string, login: string, avatarUrl?: string): GithubPerson {
    const entry = this.people.get(keyOf(host, login))
    return {
      login,
      name: entry?.name ?? null,
      avatar:
        entry?.avatar ??
        (avatarUrl || entry?.avatarUrl ? sizedAvatar(avatarUrl || entry?.avatarUrl || '') : null),
    }
  }

  /** The profile name kept for a login, fresh or not, without asking anyone. */
  nameOf(host: string, login: string): string | null {
    return this.people.get(keyOf(host, login))?.name ?? null
  }

  /**
   * Asks for a person's name and picture, unless they are kept and fresh. Gathered with the
   * other logins asked about in the same moment and sent together.
   */
  want(client: GithubClient, login: string, avatarUrl?: string): void {
    void this.lookup(client, [login], avatarUrl ? { [login]: avatarUrl } : {})
  }

  /** Every login looked up, and their pictures fetched; resolves when that is done. */
  async lookup(
    client: GithubClient,
    logins: string[],
    avatarUrls: Record<string, string> = {}
  ): Promise<void> {
    await this.loaded
    const host = client.endpoints.webHost
    const now = this.now()
    const wanted: string[] = []
    for (const login of new Set(logins.filter(Boolean))) {
      const key = keyOf(host, login)
      let entry = this.people.get(key)
      if (!entry) {
        entry = { login, name: null, seen: now }
        this.people.set(key, entry)
      }
      entry.seen = now
      const url = avatarUrls[login]
      if (url && !entry.avatarUrl) entry.avatarUrl = url
      if (this.stale(key, entry)) wanted.push(login)
    }
    if (!wanted.length) return
    await this.gather(client, wanted)
  }

  /** Whether anything about a person is missing or older than a week, and worth asking. */
  private stale(key: string, entry: Entry): boolean {
    const now = this.now()
    if ((this.failed.get(key) ?? 0) > now) return false
    const nameStale = !entry.at || now - entry.at > USER_TTL_MS
    const pictureStale = !entry.avatar || !entry.avatarAt || now - entry.avatarAt > USER_TTL_MS
    return nameStale || (pictureStale && !!entry.avatarUrl)
  }

  private gather(client: GithubClient, logins: string[]): Promise<void> {
    // One gathering per server and token: the token decides both the road and what is visible.
    const id = `${client.endpoints.api}\n${client.hasToken}`
    let g = this.gatherings.get(id)
    if (!g) {
      g = { client, logins: new Set(), timer: null, waiting: [] }
      this.gatherings.set(id, g)
    }
    for (const l of logins) g.logins.add(l)
    const gathering = g
    return new Promise<void>((resolve) => {
      gathering.waiting.push(resolve)
      gathering.timer ??= window.setTimeout(() => {
        this.gatherings.delete(id)
        void this.send(gathering.client, [...gathering.logins]).finally(() => {
          for (const done of gathering.waiting) done()
        })
      }, GATHER_MS)
    })
  }

  private async send(client: GithubClient, logins: string[]): Promise<void> {
    const host = client.endpoints.webHost
    const now = this.now()
    const names = logins.filter((l) => {
      const e = this.people.get(keyOf(host, l))
      return !e?.at || now - e.at > USER_TTL_MS
    })
    try {
      await this.readNames(client, names)
    } catch (e) {
      console.warn('[Abele] GitHub profiles could not be read', e)
    }
    await this.readPictures(client, logins)
    this.evict()
    this.scheduleSave()
  }

  private async readNames(client: GithubClient, logins: string[]): Promise<void> {
    const host = client.endpoints.webHost
    const asked = logins.filter((l) => {
      if (!noProfile(l)) return true
      this.settle(host, l, { name: null })
      return false
    })
    if (!asked.length) return

    if (client.hasToken) {
      try {
        for (let i = 0; i < asked.length; i += BATCH) {
          const batch = asked.slice(i, i + BATCH)
          const vars = Object.fromEntries(batch.map((l, j) => [`l${j}`, l]))
          const data = await client.graphql<Record<string, any>>(
            USERS_QUERY(batch.length),
            vars,
            "people's names",
            { allowMissing: true }
          )
          batch.forEach((login, j) => {
            const u = data?.[`u${j}`]
            this.settle(host, login, { name: u?.name || null, avatarUrl: u?.avatarUrl })
          })
        }
        return
      } catch (e) {
        // A server without GraphQL, or one that refuses it to this token: REST, as without one.
        console.debug('[Abele] people by GraphQL refused, asking one by one', e)
      }
    }

    for (const login of asked.slice(0, UNSIGNED_LOOKUPS)) {
      try {
        const u = await client.get<{ name?: string | null; avatar_url?: string }>(
          `/users/${encodeURIComponent(login)}`,
          { what: `${login}'s profile` }
        )
        this.settle(host, login, { name: u?.name || null, avatarUrl: u?.avatar_url })
      } catch (e) {
        if (e instanceof GithubError && e.kind === 'not-found') {
          this.settle(host, login, { name: null })
          continue
        }
        // Rate limited or offline: the rest would be refused the same way.
        for (const l of asked) this.failed.set(keyOf(host, l), this.now() + RETRY_MS)
        return
      }
    }
    for (const l of asked.slice(UNSIGNED_LOOKUPS)) {
      // Left for the next gathering, not marked read.
      this.failed.set(keyOf(host, l), this.now() + RETRY_MS)
    }
  }

  private settle(host: string, login: string, found: { name: string | null; avatarUrl?: string }) {
    const key = keyOf(host, login)
    const entry = this.people.get(key) ?? { login, name: null, seen: this.now() }
    entry.name = found.name
    entry.at = this.now()
    if (found.avatarUrl && found.avatarUrl !== entry.avatarUrl) {
      // A new picture replaces the kept one only once it has been fetched.
      entry.avatarUrl = found.avatarUrl
      entry.avatarAt = undefined
    }
    this.people.set(key, entry)
  }

  private async readPictures(client: GithubClient, logins: string[]): Promise<void> {
    const host = client.endpoints.webHost
    const now = this.now()
    const due = logins
      .map((l) => this.people.get(keyOf(host, l)))
      .filter(
        (e): e is Entry =>
          !!e?.avatarUrl && (!e.avatar || !e.avatarAt || now - e.avatarAt > USER_TTL_MS)
      )
    await Promise.all(
      due.map(async (entry) => {
        try {
          entry.avatar = await client.image(sizedAvatar(entry.avatarUrl ?? ''))
          entry.avatarAt = this.now()
        } catch (e) {
          // The address is still drawn; the browser may manage what this could not.
          console.debug('[Abele] a GitHub picture could not be fetched', e)
          this.failed.set(keyOf(host, entry.login), this.now() + RETRY_MS)
        }
      })
    )
  }

  private evict() {
    if (this.people.size <= MAX_PEOPLE) return
    const oldest = [...this.people.entries()].sort((a, b) => a[1].seen - b[1].seen)
    for (const [key] of oldest.slice(0, this.people.size - MAX_PEOPLE)) this.people.delete(key)
  }

  private scheduleSave() {
    if (!this.storage) return
    if (this.saveTimer) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, SAVE_MS)
  }

  /** Writes the cache now. */
  async save(): Promise<void> {
    if (!this.storage) return
    const stored: Stored = { version: 1, people: Object.fromEntries(this.people) }
    try {
      await this.storage.write(JSON.stringify(stored))
    } catch (e) {
      console.warn('[Abele] the GitHub people cache could not be written', e)
    }
  }

  /** Forgets every name and picture, on disk too; they are asked for again as people are shown. */
  async clear(): Promise<void> {
    await this.loaded
    this.people.clear()
    this.failed.clear()
    if (this.saveTimer) window.clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.save()
  }
}

let users: GithubUsers | null = null

/** The one cache, in `github-users.json` beside the plugin's settings. */
export function initGithubUsers(plugin: Plugin): GithubUsers {
  const adapter = plugin.app.vault.adapter
  const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/abele`
  const path = `${dir}/github-users.json`
  users = new GithubUsers({
    read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
    write: (text) => adapter.write(path, text),
  })
  return users
}

/** The cache; one kept in memory only before the plugin has made its own, as in tests. */
export function githubUsers(): GithubUsers {
  users ??= new GithubUsers()
  return users
}

/** For tests: a fresh cache, or the one given. */
export function setGithubUsers(next: GithubUsers | null): void {
  users = next
}

/** `The Octocat (octocat)` when the name is known, the login alone when not: for the agent. */
export function personLabel(host: string, login: string): string {
  const name = githubUsers().nameOf(host, login)
  return name && name !== login ? `${name} (${login})` : login
}

/**
 * The client a GitHub tab reads with, handed to the people in it so they are looked up on the
 * same server with the same token.
 */
export const GITHUB_PEOPLE: InjectionKey<() => GithubClient | null> = Symbol('abele-github-people')
