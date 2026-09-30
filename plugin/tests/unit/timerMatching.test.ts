import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { TimeEntry } from '@/entities/TimeEntry'
import { timerActiveFor } from '@/composables/useTimerButton'

const running = (groups: string[]) =>
  new TimeEntry({ wikilink: '[[Timers/Harvest]]', start: dayjs('2024-01-01'), groups })

describe('timer note matching with real path helpers', () => {
  it('does not mark empty or unrelated groups as active', () => {
    expect(timerActiveFor('Notes/Orchard.md', [])).toBe(false)
    expect(timerActiveFor('Notes/Orchard.md', [running([])])).toBe(false)
    expect(timerActiveFor('Notes/Orchard.md', [running(['[[Meadow]]'])])).toBe(false)
    expect(timerActiveFor('Notes/Orchard.md', [running(['plain text'])])).toBe(false)
  })

  // BUG: wikilinkToPath appends .md, while entryFor strips it from both candidate paths.
  // Starting a timer for a normal markdown note never turns its button into Stop Timer.
  it.fails.each(['[[Orchard]]', '[[Notes/Orchard]]', '[[Notes/Orchard.md|Fruit]]'])(
    'recognises a running timer grouped under %s',
    (group) => {
      expect(timerActiveFor('Notes/Orchard.md', [running(['[[Meadow]]']), running([group])])).toBe(
        true
      )
    }
  )
})
