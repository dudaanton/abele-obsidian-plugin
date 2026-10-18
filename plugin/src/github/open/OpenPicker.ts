import { isNativeForge, nativeLabel } from '@/forge/native'
import { forgejoConnectionClient } from '@/forge/forgejoConnections'
import { nativeOpenRows } from '@/forge/forgejoDirectory'
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
/**
 * "Open on GitHub": Obsidian's own picker, into which a GitHub link is pasted or a number, a
 * title, a branch or a commit is typed, with what GitHub has for it offered while typing.
 *
 * Which repository a bare `#12` means: the one the active GitHub tab shows; else the one the
 * GitHub tab used last shows; else the repository something was last opened in from this picker,
 * this session; else the default repository in the settings. Anything typed as `owner/repo…`
 * names its own.
 */
import { Keymap, Notice, SuggestModal, type App } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
import { watch, type WatchStopHandle } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { parseRepoInput } from '../accessCheck'
import {
  githubClient,
  githubHosts,
  githubSettings,
  lastUsedGithubLeaf,
  openGithubUrl,
  GITHUB_VIEW_TYPE,
  connectionClient,
  resolveConnectionCandidates,
  parseForSettings,
} from '../GithubService'
import { endpoints, shortName } from '../urls'
import { preferredConnection } from '../connections'
import { sameConnectionServer } from '../connectionRouting'
import type { GithubClient } from '../client'
import type { GithubViewModel } from '../model'
import { parseOpenQuery, type OpenQuery, type RepoRef } from './query'
import { OpenSearch, kindName, type OpenRow, type RowKind } from './search'

/** How long the typing has to pause before GitHub is asked. */
export const DEBOUNCE_MS = 350

const ICONS: Record<RowKind, string> = {
  pull: 'git-pull-request',
  issue: 'circle-dot',
  discussion: 'messages-square',
  commit: 'git-commit-horizontal',
  compare: 'git-compare',
  branch: 'git-branch',
  repo: 'book-marked',
  file: 'file-code',
  folder: 'folder',
  list: 'list',
  note: 'info',
}

/** The repository something was last opened in from the picker, this session. */
let lastPicked: RepoRef | null = null
let lastPickedConnection: string | undefined
let lastPickedManual = false

export const forgetLastPicked = () => {
  lastPicked = null
  lastPickedConnection = undefined
  lastPickedManual = false
}

const repoOfTarget = (model: GithubViewModel | undefined): RepoRef | null => {
  const translationItem = model?.target
  return translationItem
    ? {
        provider: translationItem.provider,
        host: translationItem.host,
        ...(translationItem.origin ? { origin: translationItem.origin } : {}),
        owner: translationItem.owner,
        repo: translationItem.repo,
      }
    : null
}

/** The repository a bare number or a title is looked up in; see the top of the file. */
export function pickerRepo(app: App): RepoRef | null {
  const active = app.workspace.getMostRecentLeaf?.() ?? null
  const view = active?.view as unknown as { getViewType?(): string; model?: GithubViewModel }
  if (view?.getViewType?.() === GITHUB_VIEW_TYPE) {
    const repo = repoOfTarget(view.model)
    if (repo) return repo
  }
  // A GitHub tab closed since is remembered still; only one that is open counts.
  const lastLeaf = lastUsedGithubLeaf()
  const open = app.workspace.getLeavesOfType?.(GITHUB_VIEW_TYPE) ?? []
  const last =
    lastLeaf && open.includes(lastLeaf)
      ? repoOfTarget((lastLeaf.view as unknown as { model?: GithubViewModel }).model)
      : null
  if (last) return last
  if (lastPicked) return lastPicked
  const configured = githubSettings().defaultRepo?.trim()
  const target = configured ? parseForSettings(configured) : null
  if (target && isNativeForge(target.provider))
    return {
      provider: target.provider,
      host: target.host,
      origin: target.origin,
      owner: target.owner,
      repo: target.repo,
    }
  return configured ? parseRepoInput(configured, endpoints(githubSettings().server).webHost) : null
}

export class OpenPicker extends SuggestModal<OpenRow> {
  private readonly rows = new SuggestionRows()
  private readonly search: OpenSearch
  private stopWatching?: WatchStopHandle
  private invalidated = false
  private readonly repo: RepoRef | null
  private readonly defaultHost: string
  private readonly defaultOrigin: string
  private timer: number | null = null
  private readonly contextId?: string
  private readonly contextManual: boolean
  private readonly forgeContext: boolean
  private readonly nativeRows = new Map<string, OpenRow[]>()
  private readonly nativePending = new Set<string>()
  private readonly choices = new Map<string, { id?: string; client: GithubClient }>()
  private choice(host: string, repo?: RepoRef): { id?: string; client: GithubClient } {
    const key = JSON.stringify([host, repo?.origin, repo?.owner, repo?.repo])
    const previous = this.choices.get(key)
    if (previous) return previous
    const target = {
      kind: 'repo' as const,
      host,
      origin: repo?.origin,
      owner: repo?.owner ?? '',
      repo: repo?.repo ?? '',
    }
    const id = resolveConnectionCandidates(target, { sourceId: this.contextId })[0]?.id
    const chosen = { id, client: id ? connectionClient(id) : githubClient(host) }
    this.choices.set(key, chosen)
    return chosen
  }

  constructor(
    app: App,
    private readonly initial = '',
    search?: OpenSearch
  ) {
    super(app)
    const active = app.workspace.getMostRecentLeaf?.()
    const activeView = active?.view as unknown as {
      model?: GithubViewModel
      getViewType?(): string
    }
    const last = lastUsedGithubLeaf()
    const remembered =
      last && (app.workspace.getLeavesOfType?.(GITHUB_VIEW_TYPE) ?? []).includes(last) ? last : null
    const model =
      activeView?.getViewType?.() === GITHUB_VIEW_TYPE
        ? activeView.model
        : (remembered?.view as unknown as { model?: GithubViewModel })?.model
    const connections = githubSettings().connections ?? []
    this.repo = pickerRepo(app)
    const nativeDefault = !preferredConnection(connections)
      ? connections.find((c) => isNativeForge(c.provider) && c.isDefault)
      : undefined
    const rememberedId = model?.connectionId ?? lastPickedConnection
    const nativeRepo = isNativeForge(this.repo?.provider) ? this.repo : null
    const rememberedConnection = connections.find(
      (c) => c.id === rememberedId && (!nativeRepo || sameConnectionServer(c, nativeRepo))
    )
    this.contextManual = model?.connectionId
      ? model.connectionIntent === 'manual'
      : lastPickedManual
    this.contextId = nativeRepo
      ? this.contextManual && rememberedId
        ? rememberedId
        : (rememberedConnection?.id ??
          resolveConnectionCandidates({ ...nativeRepo, kind: 'repo' })[0]?.id)
      : (rememberedId ?? nativeDefault?.id)
    this.forgeContext =
      !!nativeRepo || isNativeForge(model?.target?.provider) || (!!nativeDefault && !this.repo)
    this.search = search ?? new OpenSearch((host, repo) => this.choice(host, repo).client)
    const preferred = preferredConnection(githubSettings().connections ?? [])
    this.defaultHost = endpoints(preferred?.server ?? githubSettings().server).webHost
    this.defaultOrigin = endpoints(preferred?.server ?? githubSettings().server).origin
    this.limit = 50
    // Short enough for a phone's field; the empty list under it names the repository.
    this.setPlaceholder(
      this.repo
        ? t('streamB.link123TitleBranchOrCommit.2fe2be')
        : t('streamB.linkOwnerRepo123OrOwnerRepo.4e01f0')
    )
    this.setInstructions([
      { command: '↑↓', purpose: t('streamB.toNavigate.5a70bd') },
      { command: '↵', purpose: t('streamB.toOpen.9c91ea') },
      { command: 'mod ↵', purpose: t('streamB.toOpenInANewTab.e3fdb8') },
      { command: 'esc', purpose: t('streamB.toDismiss.29e1c5') },
    ])
    this.modalEl.addClass('abele-github-open')
  }

  onOpen(): void {
    void super.onOpen?.()
    this.stopWatching = watch(
      [AbeleConfig.getInstance().version, secrets().version],
      () => {
        this.invalidated = true
        this.inputEl.dispatchEvent(new Event('input'))
      },
      { flush: 'sync' }
    )
    if (this.initial) {
      this.inputEl.value = this.initial
      this.inputEl.dispatchEvent(new Event('input'))
    }
  }

  onClose(): void {
    this.rows.clear()
    this.stopWatching?.()
    this.stopWatching = undefined
    super.onClose?.()
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  parse(query: string): OpenQuery {
    return parseOpenQuery(query, {
      hosts: githubHosts(),
      defaultHost: this.defaultHost,
      defaultOrigin: this.defaultOrigin === 'https://github.com' ? undefined : this.defaultOrigin,
      repo: this.repo,
    })
  }

  getSuggestions(query: string): OpenRow[] {
    if (this.invalidated) {
      this.emptyStateText = t('streamB.githubSettingsOrKeysChangedReopenThe.e96509')
      return []
    }
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    const native = parseForSettings(query.trim())
    if (isNativeForge(native?.provider)) {
      this.emptyStateText = ''
      const kind = native.kind === 'blob' ? 'file' : native.kind === 'tree' ? 'folder' : native.kind
      return [
        {
          kind,
          title: shortName(native),
          note: `${nativeLabel(native.provider)} · ${native.origin}`,
          url: query.trim(),
        },
      ]
    }
    if (this.forgeContext && !native) {
      const available = (githubSettings().connections ?? []).some(
        (c) =>
          c.id === this.contextId &&
          isNativeForge(c.provider) &&
          (!this.repo || sameConnectionServer(c, this.repo))
      )
      if (!available) {
        this.emptyStateText = t('streamB.reapply.dd58f0ab87')
        return []
      }
      const cached = this.nativeRows.get(query)
      if (cached) {
        this.emptyStateText = cached.length ? '' : t('streamB.reapply.78fff2324a')
        return cached
      }
      if (!this.nativePending.has(query)) {
        this.timer = window.setTimeout(() => {
          this.timer = null
          if (this.invalidated) return
          this.nativePending.add(query)
          void Promise.resolve()
            .then(() =>
              nativeOpenRows(
                forgejoConnectionClient(this.contextId),
                isNativeForge(this.repo?.provider) ? `${this.repo.owner}/${this.repo.repo}` : null,
                query
              )
            )
            .then(
              (rows) => this.nativeRows.set(query, rows),
              (error) =>
                this.nativeRows.set(query, [
                  {
                    kind: 'note',
                    title: error instanceof Error ? error.message : t('streamB.reapply.2a86819a2f'),
                  },
                ])
            )
            .then(() => {
              if (!this.invalidated && this.inputEl.value === query)
                this.inputEl.dispatchEvent(new Event('input'))
            })
        }, DEBOUNCE_MS)
      }
      this.emptyStateText = t('streamB.reapply.3565fe3f64')
      return []
    }
    const q = this.parse(query)
    // A new input: whatever was waiting to be asked for the one before is not asked now.
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    if (this.search.unasked(q, this.defaultHost)) {
      this.timer = window.setTimeout(() => {
        this.timer = null
        void this.search.fetch(q, this.defaultHost).then(() => {
          // Shown only if the answer is still for what is in the field.
          if (this.inputEl.value === query) this.inputEl.dispatchEvent(new Event('input'))
        })
      }, DEBOUNCE_MS)
    }
    const view = this.search.view(q, this.defaultHost, this.repo)
    this.emptyStateText = view.message ?? ''
    return view.rows
  }

  renderSuggestion(row: OpenRow, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-github-open__row')
    if (row.kind === 'note') el.addClass('abele-github-open__note')
    this.rows.draw(el, {
      icon: ICONS[row.kind],
      title: row.title,
      note: row.note,
      aux: row.kind !== 'note' ? [{ kbd: kindName(row.kind) }] : [],
    })
  }

  /** A line that only says something — searching, a refusal — keeps the picker open. */
  selectSuggestion(row: OpenRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.kind === 'note') return
    super.selectSuggestion(row, evt)
  }

  onChooseSuggestion(row: OpenRow, evt: MouseEvent | KeyboardEvent): void {
    void this.choose(row, Keymap.isModEvent(evt) ? 'tab' : false)
  }

  async choose(row: OpenRow, pane: 'tab' | false): Promise<boolean> {
    if (this.invalidated) {
      new Notice(t('streamB.githubSettingsOrKeysChangedReopenThe.6e2846'))
      return false
    }
    if (row.kind === 'note') return false
    let url = row.url
    if (!url && row.resolve) {
      try {
        url = await row.resolve()
      } catch (e) {
        new Notice(presentUiError(e))
        return false
      }
    }
    if (!url) return false
    const nativeTarget = parseForSettings(url)
    if (nativeTarget && isNativeForge(nativeTarget.provider)) {
      const source = (githubSettings().connections ?? []).find(
        (c) => c.id === this.contextId && sameConnectionServer(c, nativeTarget)
      )
      const manual =
        this.contextManual &&
        this.contextId &&
        this.repo?.provider === nativeTarget.provider &&
        this.repo?.origin === nativeTarget.origin
      const id = manual
        ? this.contextId
        : (source?.id ?? resolveConnectionCandidates(nativeTarget)[0]?.id)
      lastPicked = {
        provider: nativeTarget.provider,
        host: nativeTarget.host,
        origin: nativeTarget.origin,
        owner: nativeTarget.owner,
        repo: nativeTarget.repo,
      }
      lastPickedConnection = id
      lastPickedManual = !!manual || (!!source && this.contextManual)
      return openGithubUrl(this.app, url, pane, {
        sourceId: id,
        sourceIntent: lastPickedManual ? 'manual' : 'automatic',
      })
    }
    if (row.repo) lastPicked = row.repo
    const chosen = row.repo ? this.choice(row.repo.host, row.repo) : undefined
    if (chosen?.client.isCurrent === false) {
      new Notice(t('streamB.theConnectionChangedReopenThePickerTo.67b398'))
      return false
    }
    const manual = this.contextManual && chosen?.id === this.contextId
    if (row.repo) {
      lastPickedConnection = chosen?.id
      lastPickedManual = manual
    }
    const opened = chosen?.id
      ? await openGithubUrl(this.app, url, pane, {
          connectionId: chosen.id,
          ...(manual ? { manual: true } : {}),
        })
      : await openGithubUrl(this.app, url, pane)
    if (!opened) new Notice(t('streamB.abeleCannotShowThatInAGithub.86e00c'))
    return opened
  }
}
