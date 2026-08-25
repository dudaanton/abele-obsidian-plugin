/**
 * Exposes internals to end-to-end tests driving the app through `obsidian eval`.
 *
 * The plugin's singletons live in module scope inside the bundle, so `obsidian eval` has no
 * way to reach them — `app.plugins.plugins.abele` only carries Obsidian's own Plugin fields.
 * This module hangs a small, explicit surface off `window` instead.
 *
 * The single call site is guarded by `process.env.NODE_ENV !== 'production'`, which Vite
 * replaces with a string literal at build time, so the guard folds to `false` and this
 * module is dropped entirely from the production bundle.
 */
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { NoteRelations } from '@/entities/NoteRelations'
import { TFile } from 'obsidian'
import type { Plugin } from 'obsidian'

export interface GroupResolveMeasurement {
  /** Wall-clock milliseconds spent inside a single uncached resolve(). */
  ms: number
  /** Number of paths the scope resolved to. */
  resolved: number
  /** Times the vault file list was walked — one per group node indicates quadratic behaviour. */
  getFilesCalls: number
  /** Times a wikilink was resolved to a destination file. */
  linkResolutions: number
  /** Times a file's metadata cache was read. */
  fileCacheReads: number
  /** Total markdown files in the vault, for context. */
  vaultFiles: number
}

export interface NoteRelationsMeasurement {
  /** Wall-clock milliseconds spent building the relation set. */
  ms: number
  /** Sorted paths gathered into each bucket. */
  tasks: string[]
  logs: string[]
  transactions: string[]
  timeEntries: string[]
  notes: string[]
  /** Times the markdown file list was walked — the journal date sweep does this. */
  getMarkdownFilesCalls: number
  fileCacheReads: number
  linkResolutions: number
  vaultFiles: number
}

export interface ResponsivenessSample {
  /** Longest stretch the main thread failed to service a 16ms timer, in milliseconds. */
  longestStallMs: number
  /** Milliseconds the measured operation itself occupied the main thread. */
  operationMs: number
  /** Timer ticks observed during the sampling window. */
  ticks: number
  /** Paths the operation resolved to, for context. */
  resolved: number
}

export interface NoteRenderSample {
  /** Longest stretch the main thread failed to service a 16ms timer, in milliseconds. */
  longestStallMs: number
  /** Sum of every stall beyond one frame — total time the UI was unusable. */
  totalStalledMs: number
  /** Elements below the note's footer once rendering settled. */
  footerNodes: number
  /** Per-list element counts, so a regression can be attributed to one list. */
  noteRows: number
  logs: number
  taskViews: number
  dateBlocks: number
  markdownBlocks: number
  /** Set once the sample is complete; poll this rather than awaiting across `eval`. */
  done: boolean
}

interface AbeleTestApi {
  ScopeResolver: typeof ScopeResolver
  ChatService: typeof ChatService
  AgentRegistry: typeof AgentRegistry
  GlobalStore: typeof GlobalStore
  plugin: Plugin
  measureGroupResolve(groupPath: string): GroupResolveMeasurement
  /** Sorted member paths of a group, via the same path the scope editor preview uses. */
  groupPreviewPaths(groupPath: string): string[]
  /** Sorted member paths computed independently from the precomputed link index. */
  groupPathsViaLinkIndex(groupPath: string): string[]
  /** Starts a responsiveness probe; poll `responsivenessResult` for the outcome. */
  startResponsivenessProbe(groupPath: string): void
  responsivenessResult: ResponsivenessSample | null
  /** Builds a note's relation set once, with instrumentation. */
  measureNoteRelations(notePath: string): NoteRelationsMeasurement
  /** Opens a note and samples what its footer costs to render; poll `noteRenderResult`. */
  startNoteRenderProbe(notePath: string, settleMs?: number): void
  noteRenderResult: NoteRenderSample | null
  /** The agents the running plugin resolved, and which one new chats start on. */
  agentsSnapshot(): AgentsSnapshot
  /** The system prompt a chat with no per-chat override would send right now. */
  resolvedSystemPrompt(): Promise<string>
}

export interface AgentsSnapshot {
  defaultAgentId: string
  defaultAgentName: string
  agents: Array<{
    id: string
    name: string
    utility: boolean
    providerId: string
    modelId: string
    promptBlocks: number
    skillsMode: string
    maxDelegateDepth: number
  }>
}

declare global {
  var __abeleTest: AbeleTestApi | undefined
}

/**
 * What the running plugin made of the settings on disk.
 *
 * Migration mutates the in-memory config and only reaches `data.json` on the next settings
 * save, so reading the file proves nothing about what the app is actually using.
 */
function agentsSnapshot(): AgentsSnapshot {
  const registry = AgentRegistry.getInstance()
  const fallback = registry.defaultAgent()

  return {
    defaultAgentId: AbeleConfig.getInstance().ai.defaultAgentId || '',
    defaultAgentName: fallback?.name ?? '',
    agents: registry.list({ includeUtility: true }).map((agent) => ({
      id: agent.id,
      name: agent.name,
      utility: agent.utility,
      providerId: agent.providerId,
      modelId: agent.modelId,
      promptBlocks: agent.prompts.length,
      skillsMode: agent.skillsMode,
      maxDelegateDepth: agent.maxDelegateDepth,
    })),
  }
}

/** Resolves the prompt through the real chat path, overrides and all. */
async function resolvedSystemPrompt(): Promise<string> {
  const service = ChatService.getInstance()
  service.ensureInitialized()
  const session = service.activeSession.value
  if (!session) return ''
  return service.getSystemPrompt(session)
}

/**
 * Resolves a group scope once with instrumentation attached, and reports both the elapsed
 * time and the number of vault API calls it took.
 *
 * Counting calls matters as much as timing them: wall-clock varies with machine and load,
 * whereas "walked the vault file list once per group node" is an unambiguous statement about
 * the algorithm. The counters are installed as temporary wrappers and always restored.
 */
function measureGroupResolve(groupPath: string): GroupResolveMeasurement {
  const { app } = GlobalStore.getInstance()

  const originalGetFiles = app.vault.getFiles
  const originalGetFileCache = app.metadataCache.getFileCache
  const originalGetFirstLinkpathDest = app.metadataCache.getFirstLinkpathDest

  let getFilesCalls = 0
  let fileCacheReads = 0
  let linkResolutions = 0

  app.vault.getFiles = function instrumentedGetFiles(...args: unknown[]) {
    getFilesCalls++
    return (originalGetFiles as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof app.vault.getFiles

  app.metadataCache.getFileCache = function instrumentedGetFileCache(...args: unknown[]) {
    fileCacheReads++
    return (originalGetFileCache).apply(this, args)
  } as typeof app.metadataCache.getFileCache

  app.metadataCache.getFirstLinkpathDest = function instrumentedDest(...args: unknown[]) {
    linkResolutions++
    return (originalGetFirstLinkpathDest as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof app.metadataCache.getFirstLinkpathDest

  try {
    const scope = new ScopeResolver()
    scope.addGroup(groupPath)

    const startedAt = performance.now()
    const resolved = scope.resolve()
    const ms = performance.now() - startedAt

    return {
      ms,
      resolved: resolved.size,
      getFilesCalls,
      linkResolutions,
      fileCacheReads,
      vaultFiles: originalGetFiles.call(app.vault).length,
    }
  } finally {
    app.vault.getFiles = originalGetFiles
    app.metadataCache.getFileCache = originalGetFileCache
    app.metadataCache.getFirstLinkpathDest = originalGetFirstLinkpathDest
  }
}

/** Member paths of a group as the scope editor's preview computes them. */
function groupPreviewPaths(groupPath: string): string[] {
  return new ScopeResolver().resolveGroupPaths(groupPath)
}

/**
 * Independent reference implementation of group membership, derived from Obsidian's
 * precomputed `resolvedLinks` index instead of by rescanning the vault.
 *
 * This exists so a test can assert the two agree on the real vault BEFORE group resolution
 * is rewritten to work this way. Agreement today is the evidence that switching basis will
 * not change which files the agent may touch.
 */
function groupPathsViaLinkIndex(groupPath: string): string[] {
  const { app } = GlobalStore.getInstance()
  const resolvedLinks = app.metadataCache.resolvedLinks

  // Reverse index: group path -> notes that declare it in their `groups` frontmatter.
  const membersOf = new Map<string, string[]>()
  for (const sourcePath of Object.keys(resolvedLinks)) {
    const file = app.vault.getAbstractFileByPath(sourcePath)
    if (!(file instanceof TFile)) continue
    const groups = app.metadataCache.getFileCache(file)?.frontmatter?.groups
    if (!Array.isArray(groups)) continue

    for (const group of groups) {
      if (typeof group !== 'string') continue
      const match = /\[\[([^\]]+)\]\]/.exec(group)
      if (!match) continue
      const linkpath = match[1].split('|')[0].split('#')[0].trim()
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
      if (!dest) continue
      const bucket = membersOf.get(dest.path)
      if (bucket) bucket.push(sourcePath)
      else membersOf.set(dest.path, [sourcePath])
    }
  }

  const result = new Set<string>()
  const walk = (path: string): void => {
    if (result.has(path)) return
    result.add(path)
    for (const member of membersOf.get(path) ?? []) walk(member)
  }
  walk(groupPath)

  // resolveGroup only adds the group note itself when it exists as a file.
  if (!app.vault.getAbstractFileByPath(groupPath)) result.delete(groupPath)

  return [...result].sort()
}

/**
 * Samples main-thread responsiveness across a group resolution.
 *
 * A 16ms interval is the budget for one frame. The longest gap between ticks is therefore
 * the length of time the UI could not respond to typing, scrolling or clicks — which is what
 * "lag on user input" actually means. Results land on `responsivenessResult` rather than
 * being returned, so the CLI can start the probe and poll for the outcome without needing
 * to await a promise across the eval boundary.
 */
function startResponsivenessProbe(groupPath: string): void {
  window.__abeleTest.responsivenessResult = null

  const gaps: number[] = []
  let previousTick = performance.now()
  let ticks = 0

  const timer = window.setInterval(() => {
    const now = performance.now()
    gaps.push(now - previousTick)
    previousTick = now
    ticks++
  }, 16)

  // Let the ticker establish a baseline, then run the operation and sample past it.
  window.setTimeout(() => {
    const scope = new ScopeResolver()
    scope.addGroup(groupPath)

    const startedAt = performance.now()
    const resolved = scope.resolve()
    const operationMs = performance.now() - startedAt

    window.setTimeout(() => {
      window.clearInterval(timer)
      window.__abeleTest.responsivenessResult = {
        longestStallMs: gaps.length ? Math.max(...gaps) : 0,
        operationMs,
        ticks,
        resolved: resolved.size,
      }
    }, 200)
  }, 200)
}

/**
 * Builds a note's relation set once and reports what it cost.
 *
 * Relation gathering walks backlinks and recurses through the group tree, so its cost grows
 * with how densely the vault links into a group's members — a different pressure from scope
 * resolution, and worth measuring separately. A journal note additionally sweeps every
 * markdown file, which `getMarkdownFilesCalls` makes visible.
 *
 * The instance is cleaned up afterwards so its file watchers do not accumulate across runs.
 */
function measureNoteRelations(notePath: string): NoteRelationsMeasurement {
  const { app } = GlobalStore.getInstance()

  const originalGetMarkdownFiles = app.vault.getMarkdownFiles
  const originalGetFileCache = app.metadataCache.getFileCache
  const originalGetFirstLinkpathDest = app.metadataCache.getFirstLinkpathDest

  let getMarkdownFilesCalls = 0
  let fileCacheReads = 0
  let linkResolutions = 0

  app.vault.getMarkdownFiles = function instrumented(...args: unknown[]) {
    getMarkdownFilesCalls++
    return (originalGetMarkdownFiles as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof app.vault.getMarkdownFiles

  app.metadataCache.getFileCache = function instrumented(...args: unknown[]) {
    fileCacheReads++
    return (originalGetFileCache).apply(this, args)
  } as typeof app.metadataCache.getFileCache

  app.metadataCache.getFirstLinkpathDest = function instrumented(...args: unknown[]) {
    linkResolutions++
    return (originalGetFirstLinkpathDest as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof app.metadataCache.getFirstLinkpathDest

  let relations: NoteRelations | null = null
  try {
    const startedAt = performance.now()
    relations = new NoteRelations(notePath)
    const ms = performance.now() - startedAt

    const sorted = (map: Map<string, unknown>): string[] => [...map.keys()].sort()

    return {
      ms,
      tasks: sorted(relations.tasks),
      logs: sorted(relations.logs),
      transactions: sorted(relations.transactions),
      timeEntries: sorted(relations.timeEntries),
      notes: sorted(relations.notes),
      getMarkdownFilesCalls,
      fileCacheReads,
      linkResolutions,
      vaultFiles: originalGetMarkdownFiles.call(app.vault).length,
    }
  } finally {
    app.vault.getMarkdownFiles = originalGetMarkdownFiles
    app.metadataCache.getFileCache = originalGetFileCache
    app.metadataCache.getFirstLinkpathDest = originalGetFirstLinkpathDest
    relations?.cleanup()
  }
}

/**
 * Opens a note in the editor and measures what rendering its footer costs.
 *
 * This is the only tier that can see the problem at all: the footer's cost is DOM
 * construction and layout, and the component tier runs on happy-dom, which computes no
 * layout. Gathering the relations is cheap — it is mounting a component per relation that
 * stalls the main thread — so the counts here are the real subject, and the stall follows
 * from them.
 *
 * `settleMs` must outlast the render being measured; a value that is too small reports a
 * partial DOM as if it were the final one.
 */
function startNoteRenderProbe(notePath: string, settleMs = 15_000): void {
  const { app } = GlobalStore.getInstance()

  window.__abeleTest.noteRenderResult = null

  const file = app.vault.getAbstractFileByPath(notePath)
  if (!(file instanceof TFile)) {
    throw new Error(`Not a file: ${notePath}`)
  }

  const gaps: number[] = []
  let previousTick = performance.now()
  let timer: number | null = null

  // Emptying the leaf first is what makes the measurement mean anything. Opening a note
  // that is already open reuses the mounted footer, so the sample would report whatever
  // paging windows a previous run had already scrolled open rather than a fresh render.
  const leaf = app.workspace.getLeaf(false)
  void leaf.setViewState({ type: 'empty' }).then(() => {
    window.setTimeout(() => {
      previousTick = performance.now()
      timer = window.setInterval(() => {
        const now = performance.now()
        gaps.push(now - previousTick)
        previousTick = now
      }, 16)

      void leaf.openFile(file)

      window.setTimeout(() => {
        if (timer) window.clearInterval(timer)

        const count = (selector: string): number => document.querySelectorAll(selector).length
        // One frame is 16ms; anything beyond that is time the UI could not respond.
        const stalls = gaps.map((gap) => gap - 16).filter((gap) => gap > 0)

        window.__abeleTest.noteRenderResult = {
          longestStallMs: stalls.length ? Math.max(...stalls) : 0,
          totalStalledMs: stalls.reduce((sum, gap) => sum + gap, 0),
          footerNodes: count('.abele-footer-view *'),
          noteRows: count('.abele-notes-list__item'),
          logs: count('.abele-log'),
          taskViews: count('.abele-task-view'),
          dateBlocks: count('.abele-timeline__date-block'),
          markdownBlocks: count('.abele-markdown'),
          done: true,
        }
      }, settleMs)
    }, 200)
  })
}

export function exposeTestApi(plugin: Plugin): void {
  window.__abeleTest = {
    ScopeResolver,
    ChatService,
    AgentRegistry,
    GlobalStore,
    plugin,
    measureGroupResolve,
    measureNoteRelations,
    groupPreviewPaths,
    groupPathsViaLinkIndex,
    startResponsivenessProbe,
    responsivenessResult: null,
    startNoteRenderProbe,
    noteRenderResult: null,
    agentsSnapshot,
    resolvedSystemPrompt,
  }
  console.debug('[Abele] test API exposed on window.__abeleTest (development build)')
}

export function removeTestApi(): void {
  delete window.__abeleTest
}
