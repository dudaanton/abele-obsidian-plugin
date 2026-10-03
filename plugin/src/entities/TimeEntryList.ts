import { pathToWikilink } from '@/helpers/pathsHelpers'
import { computed, reactive } from 'vue'
import { TimeEntry } from './TimeEntry'
import { TypedEntityList } from './TypedEntityList'

export class TimeEntryList extends TypedEntityList<TimeEntry> {
  entries = this.items
  readonly activeEntries = computed(() => {
    const result: TimeEntry[] = []
    for (const entry of this.entries.values()) if (entry.isActive) result.push(entry)
    return result
  })
  constructor() {
    super(
      'time-entry',
      (path) => reactive(new TimeEntry({ wikilink: pathToWikilink(path) })) as TimeEntry
    )
  }
}
