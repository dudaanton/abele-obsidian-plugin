import { pathToWikilink } from '@/helpers/pathsHelpers'
import { normalizePath } from 'obsidian'
import { reactive } from 'vue'
import { Task } from './Task'
import { Transaction } from './Transaction'
import { TimeEntry } from './TimeEntry'
import { Log } from './Log'
import { Note } from './Note'

// Entity construction and disposal for the summary's five existing relation maps.

export function addTask(entries: Map<string, Task>, path: string) {
  path = normalizePath(path)
  if (!entries.has(path)) {
    const task = reactive(new Task({ wikilink: pathToWikilink(path) }))
    task.load()
    entries.set(path, task as Task)
  }
}

export function removeTask(entries: Map<string, Task>, path: string) {
  path = normalizePath(path)

  const task = entries.get(path)
  if (task) {
    task.cleanup()
    entries.delete(path)
  }

  return task
}

export function addTransaction(entries: Map<string, Transaction>, path: string) {
  path = normalizePath(path)
  if (!entries.has(path)) {
    const transaction = reactive(new Transaction({ wikilink: pathToWikilink(path) }))
    transaction.load()
    entries.set(path, transaction as Transaction)
  }
}

export function removeTransaction(entries: Map<string, Transaction>, path: string) {
  path = normalizePath(path)

  const transaction = entries.get(path)
  if (transaction) {
    transaction.cleanup()
    entries.delete(path)
  }

  return transaction
}

export function addTimeEntry(entries: Map<string, TimeEntry>, path: string) {
  path = normalizePath(path)
  if (!entries.has(path)) {
    const entry = reactive(new TimeEntry({ wikilink: pathToWikilink(path) }))
    entry.load()
    entries.set(path, entry as TimeEntry)
  }
}

export function removeTimeEntry(entries: Map<string, TimeEntry>, path: string) {
  path = normalizePath(path)

  const entry = entries.get(path)
  if (entry) {
    entry.cleanup()
    entries.delete(path)
  }

  return entry
}

export function addLog(entries: Map<string, Log>, path: string, rootPath: string) {
  path = normalizePath(path)
  if (!entries.has(path)) {
    const log = reactive(new Log(path, rootPath))
    log.load()
    entries.set(path, log as Log)
  }
}

export function removeLog(entries: Map<string, Log>, path: string) {
  path = normalizePath(path)

  const log = entries.get(path)
  if (log) {
    log.cleanup()
    entries.delete(path)
  }

  return log
}

export function addNote(entries: Map<string, Note>, path: string) {
  path = normalizePath(path)
  if (!entries.has(path)) {
    const note = reactive(new Note(path))
    note.load()
    entries.set(path, note as Note)
  }
}

export function removeNote(entries: Map<string, Note>, path: string) {
  path = normalizePath(path)

  const note = entries.get(path)
  if (note) {
    note.cleanup()
    entries.delete(path)
  }

  return note
}
