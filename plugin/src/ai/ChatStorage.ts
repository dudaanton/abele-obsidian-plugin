import { GlobalStore } from '@/stores/GlobalStore'
import { AgentsService } from '@/agents/AgentsService'
import { mergeAttentionTruth, settledAttention } from '@/agents/attention'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TFile } from 'obsidian'
import { toRaw } from 'vue'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import { AiChatHistoryEntry, DEFAULT_AI_SETTINGS, type TouchedNote } from './types'
import {
  canonicalDiscussionPath,
  discussionIdentity,
  DiscussionIdentityConflict,
  isDiscussion,
} from './commentIdentity'
import { RunStorage, isRunTranscript } from './RunStorage'
import { chatCopyPath, inspectChat, readChat, rewriteChat, transformChat } from './chatCopy'
import { ChatService } from './ChatService'
import {
  parseChat,
  messageTimes,
  conversationMessageTime,
  MESSAGE_TIMES_VERSION,
  parseChatMetadata,
  serializeChat,
  serializeMetadata,
  type ChatSnapshot,
  type ChatWritePlan,
  type ParsedChat,
} from './ChatLog'

function assertChatTarget(content: string): void {
  if (isRunTranscript(content))
    throw new Error('A delegated run cannot be saved or loaded as a chat.')
}

/** The same dates `messageTimes` reads from a file, from a conversation in memory. */
function snapshotTimes(snapshot: ChatSnapshot) {
  let first = 0
  let last = 0
  for (const message of snapshot.messages) {
    const at = conversationMessageTime(message)
    if (!at) continue
    if (!first || at < first) first = at
    if (at > last) last = at
  }
  return { firstMessageAt: first, lastMessageAt: last, messageTimesVersion: MESSAGE_TIMES_VERSION }
}

export class ChatStorage {
  private static instance: ChatStorage | null = null

  static getInstance(): ChatStorage {
    if (!ChatStorage.instance) {
      ChatStorage.instance = new ChatStorage()
    }
    return ChatStorage.instance
  }

  private selectionIdentities = new Map<string, string | undefined>()
  private readonly discussionPaths = new Map<
    string,
    { id: string; revision: string; file: TFile; mtime: number; size: number }
  >()
  private readonly discussionIds = new Map<string, Set<string>>()
  private readonly discussionWrites = new WeakMap<TFile, Promise<unknown>>()
  private discussionRevision = 0

  /** A file reservation shared by preparation, discovery, rename and normal saves. */
  private async withDiscussionFile<T>(file: TFile, work: () => Promise<T>): Promise<T> {
    file = toRaw(file)
    const previous = this.discussionWrites.get(file)
    const task = (previous ?? Promise.resolve()).catch(() => {}).then(work)
    this.discussionWrites.set(file, task)
    try {
      return await task
    } finally {
      if (this.discussionWrites.get(file) === task) this.discussionWrites.delete(file)
    }
  }

  invalidateDiscussion(path?: string): void {
    if (path === undefined) {
      this.discussionPaths.clear()
      this.discussionIds.clear()
      return
    }
    const entry = this.discussionPaths.get(path)
    this.discussionPaths.delete(path)
    if (entry) {
      const paths = this.discussionIds.get(entry.id)
      paths?.delete(path)
      if (!paths?.size) this.discussionIds.delete(entry.id)
    }
  }

  discussionIdAt(path: string): string | undefined {
    const entry = this.discussionPaths.get(path)
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
    return entry &&
      file === entry.file &&
      entry.mtime === entry.file.stat.mtime &&
      entry.size === entry.file.stat.size
      ? entry.id
      : undefined
  }

  /** Synchronous UI hint only; authoritative opening/deletion uses findDiscussion. */
  discussionPathFor(id: string): string | undefined {
    const paths = this.discussionIds.get(id)
    if (paths?.size !== 1) return undefined
    const path = [...paths][0]
    return this.discussionIdAt(path) === id ? path : undefined
  }

  /** Mandatory before restoration, migration, discovery publication or a session write. */
  prepareDiscussion(
    file: TFile,
    oldLogicalPath?: string,
    options: { recover?: boolean } = {}
  ): Promise<{ snapshot: ParsedChat; identity?: string; revision: string }> {
    return this.withDiscussionFile(file, () =>
      this.prepareDiscussionLocked(file, oldLogicalPath, options.recover ?? true)
    ).catch((error) => {
      this.invalidateDiscussion(file.path)
      throw error
    })
  }

  private async prepareDiscussionLocked(
    file: TFile,
    oldLogicalPath?: string,
    recover = true
  ): Promise<{ snapshot: ParsedChat; identity?: string; revision: string }> {
    file = toRaw(file)
    const { app } = GlobalStore.getInstance()
    if (oldLogicalPath) this.invalidateDiscussion(oldLogicalPath)
    if (recover) await readChat(app, file)
    else {
      const current = parseChat(await app.vault.read(file))
      if (
        (current.torn || current.damaged || !current.metadata) &&
        (await app.vault.adapter.exists(chatCopyPath(app, file.path)))
      )
        throw new Error('This chat needs reopening. Reopen it before saving.')
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const path = canonicalDiscussionPath(file.path)
      const previous = await app.vault.read(file)
      const snapshot = parseChat(previous)
      const metadata = snapshot.metadata
      if (!metadata) {
        this.invalidateDiscussion(path)
        return { snapshot, revision: String(++this.discussionRevision) }
      }
      // A synced rename that already carries final self-location is normalized already.
      const logical = metadata.commentLocation === path ? path : (oldLogicalPath ?? path)
      const markerPath = (id: string) => `${ChatStorage.commentsFolder()}/${id}.abchat`
      let legacyOwnerEstablished = false
      if (
        !metadata.commentLocation &&
        metadata.commentId &&
        markerPath(metadata.commentId) !== logical
      ) {
        const original = app.vault.getAbstractFileByPath(markerPath(metadata.commentId))
        if (original instanceof TFile) {
          const declared = parseChatMetadata(await app.vault.read(original))
          legacyOwnerEstablished =
            isDiscussion(declared) &&
            (!declared!.commentId || declared!.commentId === metadata.commentId) &&
            (!declared!.commentLocation || declared!.commentLocation === original.path)
        }
      }
      const identity = await discussionIdentity(
        metadata,
        logical,
        markerPath,
        legacyOwnerEstablished
      )
      if (identity) {
        // Conflicting self-declarations are errors, including owners not yet discovered locally.
        for (const other of app.vault.getFiles()) {
          if (other === file || other.extension !== 'abchat') continue
          const data = parseChatMetadata(await app.vault.read(other))
          if (
            data?.commentId === identity &&
            data.commentLocation &&
            canonicalDiscussionPath(data.commentLocation) === canonicalDiscussionPath(other.path)
          ) {
            this.invalidateDiscussion(other.path)
            throw new DiscussionIdentityConflict(
              'Conflicting discussion owners. Resolve the files explicitly.'
            )
          }
        }
      }
      if (file.path !== path) continue
      if (toRaw(app.vault.getAbstractFileByPath(path)) !== file)
        throw new Error('The discussion was deleted while being prepared.')
      let committed = previous
      if (identity && (metadata.commentId !== identity || metadata.commentLocation !== path)) {
        const next = { ...metadata, commentId: identity, commentLocation: path }
        // Legacy JSON cannot accept a log record; encode its entire recognized snapshot.
        const content =
          snapshot.version === 1
            ? serializeChat({ ...snapshot, metadata: next })
            : previous + (previous.endsWith('\n') ? '' : '\n') + serializeMetadata(next)
        let changed = false
        try {
          await rewriteChat(app, file, content, (current) => {
            if (current !== previous) {
              changed = true
              throw new Error('Discussion revision changed.')
            }
            if (file.path !== path) {
              changed = true
              throw new Error('Discussion revision moved.')
            }
            if (toRaw(app.vault.getAbstractFileByPath(path)) !== file)
              throw new Error('The discussion was deleted while being prepared.')
          })
        } catch (error) {
          if (changed) continue
          throw error
        }
        committed = content
      }
      if ((await app.vault.read(file)) !== committed) continue
      // A local observation token, not an identity or a persisted assignment. Exact bytes
      // are checked at the storage boundary; the cache keeps no transcript.
      const revision = String(++this.discussionRevision)
      // No identity is visible until its exact revision was committed and read back.
      this.invalidateDiscussion(path)
      if (identity) {
        this.discussionPaths.set(path, {
          id: identity,
          revision,
          file,
          mtime: file.stat.mtime,
          size: file.stat.size,
        })
        const paths = this.discussionIds.get(identity) ?? new Set<string>()
        paths.add(path)
        this.discussionIds.set(identity, paths)
      }
      return { snapshot: parseChat(committed), identity, revision }
    }
    throw new Error('The discussion keeps changing. Reopen it after synchronization finishes.')
  }

  /** Non-session writers use the same reservation and gate as session saves. */
  async transformDiscussion(
    file: TFile,
    change: (content: string) => string,
    check?: () => void
  ): Promise<void> {
    const prepared = await this.withDiscussionFile(file, () =>
      this.prepareDiscussionLocked(file, undefined, false)
    )
    if (!prepared.identity) {
      await transformChat(GlobalStore.getInstance().app, file, change, check)
      return
    }
    await this.withDiscussionFile(file, async () => {
      await this.prepareDiscussionLocked(file, undefined, false)
      await transformChat(GlobalStore.getInstance().app, file, change, check)
      await this.prepareDiscussionLocked(file)
    })
  }

  async rewriteDiscussion(
    file: TFile,
    content: string,
    check: (previous: string) => void
  ): Promise<void> {
    const prepared = await this.withDiscussionFile(file, () =>
      this.prepareDiscussionLocked(file, undefined, false)
    )
    if (!prepared.identity) {
      await rewriteChat(GlobalStore.getInstance().app, file, content, check)
      return
    }
    await this.withDiscussionFile(file, async () => {
      await this.prepareDiscussionLocked(file, undefined, false)
      await rewriteChat(GlobalStore.getInstance().app, file, content, check)
      await this.prepareDiscussionLocked(file)
    })
  }

  /** Rebuild disposable caches, then revalidate the exact candidate. Never fall back to names. */
  async findDiscussion(id: string): Promise<TFile | null> {
    const { app } = GlobalStore.getInstance()
    const files = app.vault.getFiles().filter((file) => file.extension === 'abchat')
    const present = new Set(files.map((file) => file.path))
    for (const path of this.discussionPaths.keys())
      if (!present.has(path)) this.invalidateDiscussion(path)
    for (const file of files) {
      try {
        await this.prepareDiscussion(file)
      } catch {
        this.invalidateDiscussion(file.path) /* Conflicted/ambiguous files grant no ownership. */
      }
    }
    const path = this.discussionPathFor(id)
    if (!path) return null
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    try {
      return (await this.prepareDiscussion(file)).identity === id ? file : null
    } catch {
      return null
    }
  }

  /** Rebuild from all chat files, not history: unopened and nested discussions count too. */
  async selectionIdentityIndex(): Promise<{ path: string; chatId?: string }[]> {
    const { app } = GlobalStore.getInstance()
    const next = new Map<string, string | undefined>()
    for (const file of app.vault.getFiles().filter((file) => file.extension === 'abchat')) {
      const { metadata } = await inspectChat(app, file)
      next.set(file.path, metadata?.type === 'abele-chat' ? metadata.chatId : undefined)
    }
    this.selectionIdentities = next
    return [...this.selectionIdentities].map(([path, chatId]) => ({ path, chatId }))
  }

  private resolveChatPath(title: string): string {
    const template = AbeleConfig.getInstance().ai.chatFolder
    const name = title.replace(/[\\/:*?"<>|]/g, '-')
    const rendered = renderTemplate(template, {
      name,
      date: dayjs().format(DATE_FORMAT),
    })
    return rendered.endsWith('.abchat') ? rendered : `${rendered}.abchat`
  }

  /**
   * Writes what the plan says, and nothing more.
   *
   * The plan comes from the session's `ChatLogWriter`, which knows what the file already
   * holds. A turn usually appends a few lines; the whole file is rewritten only for a new
   * chat, a migration, or a compaction.
   */
  async saveChat(
    snapshot: ChatSnapshot,
    plan: ChatWritePlan,
    existingFile?: TFile,
    matchesRevision?: (snapshot: ParsedChat) => boolean
  ): Promise<TFile | null> {
    if (existingFile)
      return this.withDiscussionFile(existingFile, async () => {
        const prepared = await this.prepareDiscussionLocked(
          existingFile,
          undefined,
          plan.kind === 'rewrite'
        )
        if (
          prepared.identity !== snapshot.metadata.commentId &&
          (prepared.identity || isDiscussion(snapshot.metadata))
        )
          throw new Error('Discussion identity changed elsewhere. Reconcile before saving.')
        if (prepared.identity && matchesRevision && !matchesRevision(prepared.snapshot))
          throw new Error('This discussion changed elsewhere. Reconcile before saving.')
        return this.savePreparedChat(snapshot, plan, existingFile)
      })
    return this.savePreparedChat(snapshot, plan)
  }

  private async savePreparedChat(
    snapshot: ChatSnapshot,
    plan: ChatWritePlan,
    existingFile?: TFile
  ): Promise<TFile | null> {
    const { app } = GlobalStore.getInstance()
    let { metadata } = snapshot
    if (metadata.type !== 'abele-chat') throw new Error('Only a chat can be saved as a chat log.')

    if (plan.kind === 'noop') return existingFile ?? null

    if (existingFile) {
      // A stale holder must never undo a disk-confirmed answer or acknowledgement, even
      // when its file-change notification has not reached the view yet.
      const previous = await app.vault.read(existingFile)
      assertChatTarget(previous)
      const disk = parseChat(previous)
      if (
        isDiscussion(metadata) &&
        (!disk.metadata ||
          disk.metadata.commentId !== metadata.commentId ||
          disk.metadata.commentLocation !== existingFile.path)
      )
        throw new Error('Discussion identity changed elsewhere. Reconcile before saving.')
      if (
        plan.kind === 'append' &&
        (!disk.metadata ||
          ((disk.torn || disk.damaged) &&
            (await app.vault.adapter.exists(chatCopyPath(app, existingFile.path)))))
      ) {
        throw new Error('This chat needs reopening before saving its attention state.')
      }
      const guarded =
        metadata.attention !== undefined ||
        disk.metadata?.attention !== undefined ||
        metadata.commentId !== undefined ||
        disk.metadata?.commentId !== undefined
      const attention = mergeAttentionTruth(
        metadata.attention ?? {},
        disk.metadata?.attention ?? {}
      )
      const settled = settledAttention(attention)
      const next = {
        ...metadata,
        attention,
        pendingToolCalls: metadata.pendingToolCalls?.filter((tc) => !settled.has(tc.id)),
      }
      if (!next.pendingToolCalls?.length) next.pendingToolCalls = undefined
      if (JSON.stringify(next) !== JSON.stringify(metadata)) {
        if (plan.kind === 'append') {
          const before = serializeMetadata(metadata)
          const after = serializeMetadata(next)
          if (plan.data.includes(before)) plan.data = plan.data.replace(before, after)
          else {
            plan.data += after
            plan.records++
          }
        } else plan.content = serializeChat({ ...snapshot, metadata: next })
        snapshot.metadata = metadata = next
      }
      if (isDiscussion(metadata) && plan.kind === 'append') {
        // Checked append: sync may arrive after preparation but before the actual write.
        await app.vault.process(existingFile, (current) => {
          if (current !== previous)
            throw new Error('This discussion changed elsewhere. Reconcile before saving.')
          return current + plan.data
        })
      } else if (plan.kind === 'append') await app.vault.append(existingFile, plan.data)
      else
        await rewriteChat(
          app,
          existingFile,
          plan.content,
          isDiscussion(metadata) ? () => {} : undefined,
          guarded ? previous : undefined
        )
      const recorded = parseChatMetadata(await app.vault.read(existingFile))
      if (recorded)
        snapshot.metadata = metadata = {
          ...metadata,
          attention: mergeAttentionTruth(metadata.attention ?? {}, recorded.attention ?? {}),
        }
      this.updateHistoryEntry(
        existingFile.path,
        metadata.title || existingFile.basename,
        metadata.summary
      )
      this.noteMessageTimes(existingFile.path, snapshot)
      const confirmed = await this.prepareDiscussionLocked(existingFile)
      if (isDiscussion(metadata) && confirmed.identity !== metadata.commentId)
        throw new Error('Discussion identity changed during saving. Reconcile before saving again.')
      AgentsService.getInstance().saved(existingFile.path, confirmed.snapshot.metadata ?? metadata)
      return existingFile
    }

    let content = plan.kind === 'rewrite' ? plan.content : serializeChat(snapshot)
    const title = metadata.title || `Chat ${dayjs().format('YYYY-MM-DD HH-mm')}`
    const desiredPath = this.resolveChatPath(title)

    // Ensure parent folder exists
    const folder = desiredPath.substring(0, desiredPath.lastIndexOf('/'))
    if (folder) await this.ensureFolder(folder)

    const path = await getAvailablePath(desiredPath)
    if (isDiscussion(metadata)) {
      // A new discussion's birth is committed together with its location, before notification.
      metadata = snapshot.metadata = { ...metadata, commentId: nanoid(), commentLocation: path }
      content = serializeChat(snapshot)
      if (plan.kind === 'rewrite') plan.content = content
    }
    const file = await app.vault.create(path, content)
    await this.prepareDiscussion(file)

    AgentsService.getInstance().saved(file.path, metadata)
    this.addHistoryEntry({
      path: file.path,
      title: metadata.title || title,
      created: metadata.created || dayjs().format('YYYY-MM-DD'),
      summary: metadata.summary || undefined,
      ...snapshotTimes(snapshot),
    })

    return file
  }

  async loadChat(file: TFile): Promise<ParsedChat> {
    const { app } = GlobalStore.getInstance()
    assertChatTarget(await app.vault.read(file))
    const { snapshot: parsed } = await this.prepareDiscussion(file)

    if (parsed.damaged) {
      console.warn(`[Abele] ${file.path}: skipped ${parsed.damaged} unreadable record(s)`)
    }

    return parsed
  }

  getHistory(): AiChatHistoryEntry[] {
    return AbeleConfig.getInstance().ai.chatHistory || []
  }

  /**
   * Walks the chat folder: adds what is not in the index, and re-reads what has changed.
   *
   * Both halves exist for the same reason. The file is the source of truth for a chat's links,
   * its recap and its agent; the index is a copy each device keeps for itself
   * (`chatIndexFile.ts`), and nothing merges it across devices. A chat answered on a phone arrives here as a file this machine has either
   * never seen — the first half — or has an entry for that was written before any of that
   * happened, and names no notes at all. That second one is what a person saw as "I only see
   * the linked chats on the phone".
   *
   * `mtime` is what keeps it cheap: a chat folder is every conversation ever had, and each
   * file is the whole of one. Only a file that has moved on since it was last read is read.
   */
  async refreshHistory(): Promise<AiChatHistoryEntry[]> {
    const config = AbeleConfig.getInstance()
    const { app } = GlobalStore.getInstance()

    if (!config.ai.chatHistory) config.ai.chatHistory = []

    // A chat deleted in the file explorer, or by sync from another device, left its entry
    // behind: the history went on listing it and opening it found nothing.
    const present = config.ai.chatHistory.filter(
      (e) => app.vault.getAbstractFileByPath(e.path) instanceof TFile
    )
    const pruned = present.length !== config.ai.chatHistory.length
    if (pruned) config.ai.chatHistory = present
    const settle = (): AiChatHistoryEntry[] => {
      if (pruned) {
        GlobalStore.getInstance().chatLinksVersion.value++
        this.saveHistory()
      }
      return config.ai.chatHistory
    }

    const known = new Map(config.ai.chatHistory.map((e) => [e.path, e]))

    // Derive base folder from chatFolder template (strip {{...}} parts)
    const baseFolder = config.ai.chatFolder.replace(/\/?\{\{.*$/, '').replace(/\/$/, '')
    if (!baseFolder) return settle()

    const folder = app.vault.getAbstractFileByPath(baseFolder)
    if (!folder) return settle()

    const files: TFile[] = []
    const collect = (f: any) => {
      if (f instanceof TFile && (f.extension === 'abchat' || f.extension === 'json')) {
        files.push(f)
      }
      if (f.children) f.children.forEach(collect)
    }
    collect(folder)

    let added = 0
    let changed = pruned
    for (const file of files) {
      const entry = known.get(file.path)
      if (entry) {
        // Ours and open in a tab writes through `linkNotes` as it goes, so the index is
        // already ahead of anything read here; everything else is judged by the clock.
        // An entry from before the dates were kept is read once more to fill them in.
        if (
          entry.mtime === file.stat.mtime &&
          entry.lastMessageAt !== undefined &&
          entry.messageTimesVersion === MESSAGE_TIMES_VERSION
        )
          continue
        changed = (await this.syncEntry(entry, file)) || changed
        continue
      }

      try {
        // Only the metadata is needed here, and in a log that is one line out of thousands.
        const content = await app.vault.read(file)
        const metadata = parseChatMetadata(content)
        if (metadata?.type !== 'abele-chat') continue
        const times = messageTimes(content)
        config.ai.chatHistory.push({
          path: file.path,
          title: metadata.title || file.basename,
          created: metadata.created || '',
          // The file is the source of truth for these three; this is where the index is
          // rebuilt out of it, for a chat that arrived by sync or a restore.
          notes: metadata.touched?.length ? metadata.touched : undefined,
          recap: metadata.recap || undefined,
          summary: metadata.summary || undefined,
          agentId: metadata.agentId || undefined,
          firstMessageAt: times.first,
          lastMessageAt: times.last,
          messageTimesVersion: MESSAGE_TIMES_VERSION,
          mtime: file.stat.mtime,
        })
        added++
      } catch {
        // Not a valid chat file
      }
    }

    if (added) {
      config.ai.chatHistory.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    }
    if (added || changed) {
      // Those entries were built out of the files' own `touched`, so they carry links nothing
      // has drawn yet.
      GlobalStore.getInstance().chatLinksVersion.value++
      this.saveHistory()
    }

    return config.ai.chatHistory
  }

  /**
   * One chat file, read back into its entry — for the vault saying it has changed.
   *
   * Sync lands while the app is running, under a footer that is already on screen. Nothing is
   * done for a file with no entry: an unknown chat joins the index through `refreshHistory`,
   * which is where the folder is walked and the file is judged to be a chat at all.
   */
  async refreshEntry(file: TFile): Promise<void> {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === file.path)
    if (
      !entry ||
      (entry.mtime === file.stat.mtime && entry.messageTimesVersion === MESSAGE_TIMES_VERSION)
    )
      return

    if (await this.syncEntry(entry, file)) {
      GlobalStore.getInstance().chatLinksVersion.value++
      this.saveHistory()
    }
  }

  /**
   * Copies what a chat file says about itself into its index entry.
   *
   * Answers whether anything a reader would notice moved, so the caller can decide whether to
   * pay for an index write: the index is one JSON file holding every chat's entry.
   */
  private async syncEntry(entry: AiChatHistoryEntry, file: TFile): Promise<boolean> {
    const { app } = GlobalStore.getInstance()

    let metadata
    let times
    try {
      const content = await app.vault.read(file)
      metadata = parseChatMetadata(content)
      times = messageTimes(content)
    } catch {
      return false
    }
    // The clock is recorded either way: a file that cannot be parsed as a chat is not a file
    // to try again on every refresh.
    const seen = entry.mtime
    entry.mtime = file.stat.mtime
    if (metadata?.type !== 'abele-chat') return seen === undefined

    // The three the type calls mirrored, and not the title: a chat renamed here has its new
    // name in the index before the file has been written again, and reading the file back
    // would take that name away from the person who just gave it.
    const notes = metadata.touched?.length ? metadata.touched : undefined
    const recap = metadata.recap || undefined
    const agentId = metadata.agentId || undefined
    // A summary is only ever added, never taken away: an entry that has one keeps it against a
    // file written by an older build that did not know the field.
    const summary = metadata.summary || entry.summary

    const same =
      JSON.stringify(entry.notes) === JSON.stringify(notes) &&
      entry.recap === recap &&
      entry.summary === summary &&
      entry.agentId === agentId &&
      entry.firstMessageAt === times.first &&
      entry.lastMessageAt === times.last &&
      entry.messageTimesVersion === MESSAGE_TIMES_VERSION

    entry.messageTimesVersion = MESSAGE_TIMES_VERSION
    entry.firstMessageAt = times.first
    entry.lastMessageAt = times.last
    entry.notes = notes
    entry.recap = recap
    entry.summary = summary
    entry.agentId = agentId

    return !same || seen === undefined
  }

  async renameChat(file: TFile, newTitle: string): Promise<TFile | null> {
    const { app } = GlobalStore.getInstance()
    const oldPath = file.path
    const newPath = this.resolveChatPath(newTitle)

    // Same path — nothing to do
    if (oldPath === newPath) return null

    const folder = newPath.substring(0, newPath.lastIndexOf('/'))
    if (folder) await this.ensureFolder(folder)

    const availablePath = await getAvailablePath(newPath)
    await app.fileManager.renameFile(file, availablePath)

    // Update history entry
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === oldPath)
    if (entry) {
      entry.path = availablePath
      entry.title = newTitle
      // The card opens the chat by path, and the title is what it shows.
      GlobalStore.getInstance().chatLinksVersion.value++
      await config.saveChatIndex()
    }

    return app.vault.getFileByPath(availablePath)
  }

  async deleteChat(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      // Delegated runs live in sidecar files reachable only through this chat. Left behind,
      // they would be unreachable clutter that nothing ever cleans up.
      await this.deleteRunsOf(file)
      await app.fileManager.trashFile(file)
    }
    this.removeHistoryEntry(path)
  }

  private async deleteRunsOf(file: TFile): Promise<void> {
    const { app } = GlobalStore.getInstance()
    try {
      const data = parseChat(await app.vault.read(file))
      const runIds = (data.messages ?? [])
        .map((m) => m.subAgentRun?.runId)
        .filter((id): id is string => Boolean(id))
      if (runIds.length) await RunStorage.getInstance().deleteRuns(runIds)
    } catch {
      // An unreadable chat file has no runs we can identify; deleting it is still correct.
    }
  }

  async migrateChats(): Promise<number> {
    const { app } = GlobalStore.getInstance()
    const config = AbeleConfig.getInstance()
    const history = [...(config.ai.chatHistory || [])]
    let moved = 0

    for (const entry of history) {
      const file = app.vault.getAbstractFileByPath(entry.path)
      if (!(file instanceof TFile)) continue

      const newDesired = this.resolveChatPath(entry.title || file.basename)
      if (newDesired === entry.path) continue

      const folder = newDesired.substring(0, newDesired.lastIndexOf('/'))
      if (folder) await this.ensureFolder(folder)

      const availablePath = await getAvailablePath(newDesired)
      await app.fileManager.renameFile(file, availablePath)
      entry.path = availablePath
      moved++
    }

    config.ai.chatHistory = history
    await config.saveChatIndex()
    return moved
  }

  // ── History management (stored in the plugin's chat-index.json: `chatIndexFile.ts`) ──

  /**
   * Writes the history without the caller waiting on it. Those callers are chat writes and
   * index syncs that must not stall on the index file, so nobody awaits this — and a write
   * that fails, or that lands after the plugin unloaded, is logged here rather than left as an
   * unhandled rejection.
   */
  private saveHistory(): void {
    AbeleConfig.getInstance()
      .saveChatIndex()
      .catch((err) => console.error('[Abele] Failed to save the chat history', err))
  }

  /** Public because expansion adds a comment file to the history the moment it becomes a chat. */
  addHistoryEntry(entry: AiChatHistoryEntry): void {
    const config = AbeleConfig.getInstance()
    if (!config.ai.chatHistory) config.ai.chatHistory = []
    // The path keys the history index, independently of the durable selection chatId.
    // Expansion runs on every reopen, so without this the same conversation is listed twice.
    if (config.ai.chatHistory.some((e) => e.path === entry.path)) return
    config.ai.chatHistory.unshift(entry)
    // A chat arriving in the index may already name notes — an expanded comment does, and so
    // does one that came in by sync. Without this its card never appears under them.
    GlobalStore.getInstance().chatLinksVersion.value++
    this.saveHistory()
  }

  /**
   * Mirrors a chat's note links into its history entry, so a footer never opens a chat file.
   *
   * A no-op when the path has no entry — which is how an unexpanded comment stays out of every
   * footer without a rule of its own: a comment is not in the history until it is expanded.
   */
  linkNotes(chatPath: string, notes: TouchedNote[], recap?: string, agentId?: string): void {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === chatPath)
    if (!entry) return

    const next = notes.length ? notes : undefined
    const unchanged =
      JSON.stringify(entry.notes) === JSON.stringify(next) &&
      entry.recap === (recap || undefined) &&
      entry.agentId === (agentId || undefined)
    // The index is one JSON file holding every chat's entry, so a save that changed nothing
    // costs more than the chat write that prompted it. Same guard as `updateHistoryEntry`.
    if (unchanged) return

    entry.notes = next
    entry.recap = recap || undefined
    entry.agentId = agentId || undefined
    GlobalStore.getInstance().chatLinksVersion.value++
    this.saveHistory()
  }

  /**
   * The folder comments live in.
   *
   * Here rather than on `CommentService`, which reads it through this: the two answers have to
   * be the same one, and a blank setting meaning the built-in folder to one reader and nothing
   * at all to the other is how the rename skip stopped holding.
   */
  static commentsFolder(): string {
    return AbeleConfig.getInstance().ai.commentFolder || DEFAULT_AI_SETTINGS.commentFolder
  }

  /** Whether a chat file lives in the comments folder, and so is a comment's to rewrite. */
  private isCommentPath(path: string): boolean {
    return path.startsWith(`${ChatStorage.commentsFolder()}/`)
  }

  /**
   * Rewrites one note path in a list of links, keeping when it was written.
   *
   * Static because `CommentService` needs the same rewrite over a comment's file, and a rename
   * that produced two different answers in the two places is the bug this avoids.
   */
  static renamedNotes(notes: TouchedNote[], oldPath: string, newPath: string): TouchedNote[] {
    return notes.map((note) => (note.path === oldPath ? { path: newPath, at: note.at } : note))
  }

  /**
   * Follows a renamed note into every chat that wrote it — the index entry and the file both.
   *
   * Only the chats that name the old path are read: a rename of a note nothing worked on costs
   * one walk of an in-memory array and no disk at all.
   */
  async handleNoteRename(oldPath: string, newPath: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const config = AbeleConfig.getInstance()
    const affected = this.getHistory().filter((entry) =>
      entry.notes?.some((note) => note.path === oldPath)
    )
    if (!affected.length) return

    for (const entry of affected) {
      entry.notes = ChatStorage.renamedNotes(entry.notes ?? [], oldPath, newPath)

      // Through the open session when there is one, so its log writer stays in step with the
      // file it thinks it wrote; otherwise straight onto the end of the file, which is what a
      // chat log is — the last meta record wins.
      const session = ChatService.getInstance().getSessionByFile(entry.path)
      if (session) {
        session.touched.value = ChatStorage.renamedNotes(session.touched.value, oldPath, newPath)
        await session.save()
        continue
      }

      // A comment's file belongs to `CommentService.handleRename`, which rewrites `touched`
      // there alongside the anchor. Both walks run on the same rename, and two of them reading
      // this file and appending to it would leave whichever landed last overwriting the
      // other's field — the anchor or the links, at random.
      if (this.isCommentPath(entry.path)) continue

      const file = app.vault.getAbstractFileByPath(entry.path)
      if (!(file instanceof TFile)) continue
      const metadata = parseChatMetadata(await app.vault.read(file))
      if (!metadata?.touched?.length) continue
      const touched = ChatStorage.renamedNotes(metadata.touched, oldPath, newPath)
      if (JSON.stringify(touched) === JSON.stringify(metadata.touched)) continue
      await this.transformDiscussion(file, (content) => {
        const current = parseChatMetadata(content)
        if (!current) throw new Error('The chat is unavailable.')
        return (
          content +
          serializeMetadata({
            ...current,
            touched: ChatStorage.renamedNotes(current.touched ?? [], oldPath, newPath),
          })
        )
      })
    }

    GlobalStore.getInstance().chatLinksVersion.value++
    await config.saveChatIndex()
  }

  /**
   * The index is a single JSON file holding every chat's history entry, so
   * writing it on a save that changed no title would cost more than the chat write itself.
   */
  private updateHistoryEntry(path: string, title: string, summary?: string): void {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === path)
    if (!entry) return
    const nextSummary = summary || entry.summary
    if (entry.title === title && entry.summary === nextSummary) return
    entry.title = title
    entry.summary = nextSummary
    this.saveHistory()
  }

  /**
   * Keeps an open chat's dates current in its entry as it is written in, without a settings write
   * of its own: the index is one file holding every chat, and a turn saves many times. The next
   * write of the index for any reason carries them, and the file's changed time has the next
   * `refreshHistory` read them from the file anyway.
   */
  private noteMessageTimes(path: string, snapshot: ChatSnapshot): void {
    const entry = AbeleConfig.getInstance().ai.chatHistory?.find((e) => e.path === path)
    if (!entry) return
    Object.assign(entry, snapshotTimes(snapshot))
  }

  /** Records a summary written for a chat that is not open, into its index entry. */
  setSummary(path: string, summary: string): void {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === path)
    if (!entry || entry.summary === summary) return
    entry.summary = summary
    this.saveHistory()
  }

  /**
   * Public for the other direction: a comment returned to its note is a margin note again,
   * and a margin note has no business in the list of conversations somebody browses.
   */
  removeHistoryEntry(path: string): void {
    const config = AbeleConfig.getInstance()
    if (!config.ai.chatHistory) return
    config.ai.chatHistory = config.ai.chatHistory.filter((e) => e.path !== path)
    // The entry carried the links, so its card has to go with it — a comment sent back to its
    // note, or a chat deleted, must not leave a card behind pointing at nothing.
    GlobalStore.getInstance().chatLinksVersion.value++
    this.saveHistory()
  }

  /** Public because `CommentService` creates the comment folder before writing into it. */
  async ensureFolder(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const parts = path.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      if (!app.vault.getAbstractFileByPath(current)) {
        await app.vault.createFolder(current)
      }
    }
  }

  static destroy(): void {
    ChatStorage.instance = null
  }
}
