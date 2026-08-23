import { TFile, TFolder } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { ChatMessage } from './types'

export type RunStatus = 'running' | 'done' | 'error' | 'aborted'

export interface RunBranch {
  /** The item this branch was handed, or the task itself when there was no fan-out. */
  item: string
  status: RunStatus
  /** The result text the sub-agent finished with. */
  result?: string
  error?: string
  messages: ChatMessage[]
}

export interface RunFile {
  type: 'abele-run'
  runId: string
  agentId: string
  agentName: string
  /** Path of the chat that delegated, so a run can link back. */
  parentChat: string
  /** The tool call inside that chat, so the branch renders in the right place. */
  parentToolCallId: string
  task: string
  created: string
  status: RunStatus
  depth: number
  branches: RunBranch[]
}

/**
 * Reads and writes the sidecar file a delegated run lives in.
 *
 * Runs are kept out of the parent chat on purpose. `ChatSession.save()` rewrites a whole chat
 * file on every tool call, approval and branch switch, and the largest chat in a working vault
 * runs to 273 KB; folding run transcripts into it would multiply that cost by however many
 * sub-agents were dispatched.
 *
 * Run files also carry no `internalMessages`. Those exist to resume a conversation, and a
 * finished run is never resumed — dropping them roughly halves the file.
 */
export class RunStorage {
  private static instance: RunStorage | null = null

  static getInstance(): RunStorage {
    if (!RunStorage.instance) RunStorage.instance = new RunStorage()
    return RunStorage.instance
  }

  static destroy(): void {
    RunStorage.instance = null
  }

  /** Runs sit beside the chats, in a folder Obsidian hides from the file explorer. */
  runsFolder(): string {
    const template = AbeleConfig.getInstance().ai.chatFolder || 'AI/Chats'
    const base = template.replace(/\/?\{\{.*$/, '').replace(/\/$/, '')
    return base ? `${base}/.runs` : '.runs'
  }

  runPath(runId: string): string {
    return `${this.runsFolder()}/${runId}.abchat`
  }

  async save(run: RunFile): Promise<TFile | null> {
    const { app } = GlobalStore.getInstance()
    const path = this.runPath(run.runId)

    try {
      await this.ensureFolder(this.runsFolder())
      const content = JSON.stringify(run)

      const existing = app.vault.getAbstractFileByPath(path)
      if (existing instanceof TFile) {
        await app.vault.modify(existing, content)
        return existing
      }
      return await app.vault.create(path, content)
    } catch (err) {
      console.error('[Abele] Failed to save run', path, err)
      return null
    }
  }

  async load(runId: string): Promise<RunFile | null> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(this.runPath(runId))
    if (!(file instanceof TFile)) return null

    try {
      const run = JSON.parse(await app.vault.read(file)) as RunFile
      return this.markInterrupted(run)
    } catch (err) {
      console.error('[Abele] Failed to read run', runId, err)
      return null
    }
  }

  /**
   * A run that was still going when the app closed has no in-memory state to resume, so it is
   * reported as aborted rather than as forever running.
   */
  private markInterrupted(run: RunFile): RunFile {
    if (run.status !== 'running') return run

    return {
      ...run,
      status: 'aborted',
      branches: run.branches.map((b) =>
        b.status === 'running' ? { ...b, status: 'aborted' as const } : b
      ),
    }
  }

  /** Removes the runs a chat started. Called when that chat is deleted. */
  async deleteRuns(runIds: string[]): Promise<void> {
    const { app } = GlobalStore.getInstance()
    for (const runId of runIds) {
      const file = app.vault.getAbstractFileByPath(this.runPath(runId))
      if (file instanceof TFile) {
        try {
          await app.fileManager.trashFile(file)
        } catch (err) {
          console.error('[Abele] Failed to delete run', runId, err)
        }
      }
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    if (app.vault.getAbstractFileByPath(path) instanceof TFolder) return

    const parts = path.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      if (!app.vault.getAbstractFileByPath(current)) {
        try {
          await app.vault.createFolder(current)
        } catch {
          // Another write got there first; that is fine.
        }
      }
    }
  }
}
