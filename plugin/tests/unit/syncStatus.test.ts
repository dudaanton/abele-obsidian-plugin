import { describe, expect, it } from 'vitest'
import {
  DISCONNECTED_STATUS,
  STATUS_ICON,
  STATUS_LABEL,
  renderStatus,
  statusOf,
  statusText,
  statusTooltip,
  type SyncState,
  type SyncStatus,
} from '@/sync/status'
import { formatWhen, reasonOf } from '@/sync/format'

/**
 * The words and the one line of DOM the status bar is made of. Everything a person reads about
 * sync outside the settings tab is here, so this is where the vocabulary is pinned down.
 */

const STATES: SyncState[] = ['disconnected', 'idle', 'syncing', 'paused', 'offline', 'error']

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  ...DISCONNECTED_STATUS,
  state: 'idle',
  ...over,
})

describe('the status vocabulary', () => {
  it('gives every state a label and a glyph', () => {
    for (const state of STATES) {
      expect(STATUS_LABEL[state]).toBeTruthy()
      expect(STATUS_ICON[state]).toBeTruthy()
    }
  })

  it('says what a person expects rather than what the engine calls it', () => {
    expect(STATUS_LABEL.idle).toBe('Fully synced')
    expect(STATUS_LABEL.disconnected).toBe('Not connected')
  })

  it('carries the engine status through unchanged but for the wider state', () => {
    const engine = {
      state: 'offline' as const,
      pending: 3,
      lastSyncAt: '2026-09-05T10:00:00.000Z',
      lastError: 'the server never answered',
      cursor: 12,
      headSeq: 14,
    }
    expect(statusOf(engine)).toEqual(engine)
  })

  it('counts what is left only while a sync is going', () => {
    expect(statusText(status({ state: 'syncing', pending: 4 }))).toBe('Syncing (4)')
    expect(statusText(status({ state: 'syncing', pending: 0 }))).toBe('Syncing')
    // Pending outside a sync is what the last push kept back, not a number to put in the bar.
    expect(statusText(status({ state: 'idle', pending: 4 }))).toBe('Fully synced')
  })

  it('tells a disconnected device apart from one that has never synced', () => {
    expect(statusTooltip(DISCONNECTED_STATUS)).toBe('Abele Sync: Not connected')
    expect(statusTooltip(status({ lastSyncAt: null }))).toContain('Last sync never')
  })

  it('puts the last failure in the tooltip', () => {
    const tooltip = statusTooltip(status({ state: 'error', lastError: 'the token was refused' }))
    expect(tooltip).toContain('Sync error')
    expect(tooltip).toContain('the token was refused')
  })
})

describe('renderStatus', () => {
  it('builds the item from elements, with the glyph and the label', () => {
    const el = document.createElement('div')
    renderStatus(el, status({ state: 'syncing', pending: 2 }))

    expect(el.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(STATUS_ICON.syncing)
    expect(el.textContent).toContain('Syncing (2)')
    expect(el.getAttribute('aria-label')).toContain('Syncing')
    expect(el.classList.contains('abele-sync-status')).toBe(true)
  })

  it('replaces what was there rather than adding to it', () => {
    const el = document.createElement('div')
    renderStatus(el, status({ state: 'syncing' }))
    renderStatus(el, status({ state: 'idle' }))

    expect(el.textContent).toBe('Fully synced')
    expect(el.querySelectorAll('[data-icon]')).toHaveLength(1)
  })
})

describe('formatWhen', () => {
  it('says never before anything has happened', () => {
    expect(formatWhen(null)).toBe('never')
    expect(formatWhen('')).toBe('never')
    expect(formatWhen('not a date')).toBe('never')
  })

  it('says how long ago it was', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    expect(formatWhen(twoMinutesAgo)).toBe('2 minutes ago')
  })
})

/**
 * What a screen puts in front of a person when something failed.
 *
 * `String(value)` is the obvious thing and the wrong one: on anything that is not an `Error`
 * or a string it reads `[object Object]`, which looks like a bug in this plugin rather than
 * like a server refusing something.
 */
describe('reasonOf', () => {
  it("says what an error's message says", () => {
    expect(reasonOf(new Error('the token is no good'))).toBe('the token is no good')
  })

  it('takes a thrown string at its word', () => {
    expect(reasonOf('the vault is full')).toBe('the vault is full')
  })

  it('says a reason was not given rather than stringifying an object at somebody', () => {
    expect(reasonOf({ code: 'quota' })).toBe('no reason was given')
    expect(reasonOf(null)).toBe('no reason was given')
    expect(reasonOf(undefined)).toBe('no reason was given')
    // An empty string is a message that says nothing, which is the same as none.
    expect(reasonOf('')).toBe('no reason was given')
  })
})
