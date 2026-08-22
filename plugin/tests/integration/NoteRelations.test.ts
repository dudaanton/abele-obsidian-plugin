/**
 * Behavioural contract for what a note gathers from its group tree.
 *
 * A group note collects the tasks, logs, transactions and time entries of everything
 * beneath it — including members of its subgroups, at any depth. This is what makes a
 * project note show the tasks filed against its subprojects, and it is the second place
 * (after scope resolution) where the `groups` relation is walked. Both share the same link
 * primitives, so both have to be pinned before those primitives change.
 *
 * A journal note additionally sweeps the whole vault for anything dated to its day.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, dailyJournal, configureAbele } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

// Group tree, arrows from a member to the group it belongs to:
//   Notes/Projects.md                      (root)
//     Notes/Website.md          -> [[Projects]]
//       Tasks/Design login.md   -> [[Website]]    task two levels below the root
//       Time/Website work.md    -> [[Website]]
//     Tasks/Plan roadmap.md     -> [[Projects]]   task directly in the root
//   Notes/Kitchen.md                       (separate root — must never leak in)
//     Tasks/Buy a kettle.md     -> [[Kitchen]]
const VAULT: FakeFileSpec[] = [
  { path: 'Notes/Projects.md', content: 'Projects\n' },
  { path: 'Notes/Website.md', frontmatter: { groups: ['[[Projects]]'] }, content: 'Website\n' },
  {
    path: 'Tasks/Design login.md',
    frontmatter: { type: 'task', created: '2026-08-20', groups: ['[[Website]]'] },
    content: 'Design login\n',
  },
  {
    path: 'Tasks/Plan roadmap.md',
    frontmatter: { type: 'task', created: '2026-08-20', groups: ['[[Projects]]'] },
    content: 'Plan roadmap\n',
  },
  {
    path: 'Time/Website work.md',
    frontmatter: {
      type: 'time-entry',
      start: '2026-08-22T09:00:00',
      end: '2026-08-22T10:00:00',
      groups: ['[[Website]]'],
    },
    content: '',
  },
  {
    path: 'Finance/Transactions/Hosting.md',
    frontmatter: {
      type: 'transaction',
      date: '2026-08-22',
      amount: 12,
      currency: 'EUR',
      groups: ['[[Website]]'],
    },
    content: 'Hosting\n',
  },
  { path: 'Notes/Kitchen.md', content: 'Kitchen\n' },
  {
    path: 'Tasks/Buy a kettle.md',
    frontmatter: { type: 'task', created: '2026-08-20', groups: ['[[Kitchen]]'] },
    content: 'Buy a kettle\n',
  },
  {
    path: 'Journals/2026/2026-08-22.md',
    frontmatter: { type: 'journal' },
    content: 'Worked on [[Website]] all afternoon.\n',
  },
]

function relationsFor(path: string): NoteRelations {
  return new NoteRelations(path)
}

describe('NoteRelations — gathering through the group tree', () => {
  let relations: NoteRelations | null = null

  beforeEach(() => {
    useVault(VAULT)
    configureAbele()
  })

  afterEach(() => {
    relations?.cleanup()
    relations = null
    // The watcher wrapper is a singleton and would otherwise carry file subscriptions from
    // one test into the next.
    VaultWatcherWrapper.destroy()
  })

  it('collects a task filed directly against the group', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.tasks.keys()]).toContain('Tasks/Plan roadmap.md')
  })

  it('collects a task from a subgroup two levels down', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.tasks.keys()]).toContain('Tasks/Design login.md')
  })

  it('does not collect a task from an unrelated group', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.tasks.keys()]).not.toContain('Tasks/Buy a kettle.md')
  })

  it('collects a journal that mentions a member of a subgroup', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.logs.keys()]).toContain('Journals/2026/2026-08-22.md')
  })

  it('collects a time entry from a subgroup', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.timeEntries.keys()]).toContain('Time/Website work.md')
  })

  it('collects a transaction from a subgroup', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.transactions.keys()]).toContain('Finance/Transactions/Hosting.md')
  })

  it('files the subgroup note itself under plain notes', () => {
    relations = relationsFor('Notes/Projects.md')
    expect([...relations.notes.keys()]).toContain('Notes/Website.md')
  })

  it('narrows to the subtree when asked about the subgroup', () => {
    relations = relationsFor('Notes/Website.md')
    const tasks = [...relations.tasks.keys()]
    expect(tasks).toContain('Tasks/Design login.md')
    // Plan roadmap belongs to Projects, which sits above Website.
    expect(tasks).not.toContain('Tasks/Plan roadmap.md')
  })

  it('never lists the note itself among its own relations', () => {
    relations = relationsFor('Notes/Projects.md')
    const everything = [
      ...relations.tasks.keys(),
      ...relations.notes.keys(),
      ...relations.logs.keys(),
    ]
    expect(everything).not.toContain('Notes/Projects.md')
  })
})

describe('NoteRelations — cycles and malformed groups', () => {
  let relations: NoteRelations | null = null

  afterEach(() => {
    relations?.cleanup()
    relations = null
    VaultWatcherWrapper.destroy()
  })

  it('terminates when two notes group into each other', () => {
    useVault([
      { path: 'Notes/A.md', frontmatter: { groups: ['[[B]]'] }, content: 'A\n' },
      { path: 'Notes/B.md', frontmatter: { groups: ['[[A]]'] }, content: 'B\n' },
    ])
    configureAbele()

    relations = relationsFor('Notes/A.md')

    // Pinning current behaviour, quirk included: A ends up listed among its own relations.
    // The self-reference guard in addBacklink compares against the path being expanded at
    // that level, not against the note the relations belong to, so once recursion steps into
    // B the walk back to A looks like an ordinary backlink. Termination is what matters here
    // and it does terminate; if this is ever tightened, this expectation is the record of
    // what changed.
    expect([...relations.notes.keys()]).toEqual(['Notes/B.md', 'Notes/A.md'])
  })

  it('ignores a groups value that is not an array', () => {
    useVault([
      { path: 'Notes/Projects.md', content: 'Projects\n' },
      { path: 'Notes/Bad.md', frontmatter: { groups: '[[Projects]]' }, content: 'Bad\n' },
      {
        path: 'Tasks/Hidden.md',
        frontmatter: { type: 'task', groups: ['[[Bad]]'] },
        content: 'Hidden\n',
      },
    ])
    configureAbele()

    relations = relationsFor('Notes/Projects.md')
    // Bad's malformed frontmatter is not a link, so nothing links to Projects at all.
    expect([...relations.tasks.keys()]).toEqual([])
  })

  it('ignores a group entry that resolves to nothing', () => {
    useVault([
      { path: 'Notes/Projects.md', content: 'Projects\n' },
      {
        path: 'Tasks/Dangling.md',
        frontmatter: { type: 'task', groups: ['[[Nonexistent]]'] },
        content: 'Dangling\n',
      },
    ])
    configureAbele()

    relations = relationsFor('Notes/Projects.md')
    expect([...relations.tasks.keys()]).toEqual([])
  })
})

describe('NoteRelations — journal notes sweep by date', () => {
  let relations: NoteRelations | null = null

  const JOURNAL_VAULT: FakeFileSpec[] = [
    { path: 'Journals/2026/2026-08-22.md', frontmatter: { type: 'journal' }, content: 'Today\n' },
    {
      path: 'Tasks/Due today.md',
      frontmatter: { type: 'task', due: '2026-08-22' },
      content: 'Due today\n',
    },
    {
      path: 'Tasks/Dated today.md',
      frontmatter: { type: 'task', date: '2026-08-22' },
      content: 'Dated today\n',
    },
    {
      path: 'Tasks/Created today.md',
      frontmatter: { type: 'task', created: '2026-08-22' },
      content: 'Created today\n',
    },
    {
      path: 'Tasks/Another day.md',
      frontmatter: { type: 'task', due: '2026-08-01' },
      content: 'Another day\n',
    },
    {
      path: 'Finance/Transactions/Coffee.md',
      frontmatter: { type: 'transaction', date: '2026-08-22', amount: 3, currency: 'EUR' },
      content: 'Coffee\n',
    },
  ]

  beforeEach(() => {
    useVault(JOURNAL_VAULT)
    configureAbele({ journals: [dailyJournal()] })
  })

  afterEach(() => {
    relations?.cleanup()
    relations = null
    VaultWatcherWrapper.destroy()
  })

  it('collects tasks due on the journal date', () => {
    relations = relationsFor('Journals/2026/2026-08-22.md')
    expect([...relations.tasks.keys()]).toContain('Tasks/Due today.md')
  })

  it('collects tasks whose event date is the journal date', () => {
    relations = relationsFor('Journals/2026/2026-08-22.md')
    expect([...relations.tasks.keys()]).toContain('Tasks/Dated today.md')
  })

  it('falls back to the created date when no due or event date is set', () => {
    relations = relationsFor('Journals/2026/2026-08-22.md')
    expect([...relations.tasks.keys()]).toContain('Tasks/Created today.md')
  })

  it('ignores anything dated to another day', () => {
    relations = relationsFor('Journals/2026/2026-08-22.md')
    expect([...relations.tasks.keys()]).not.toContain('Tasks/Another day.md')
  })

  it('collects transactions dated to the journal day', () => {
    relations = relationsFor('Journals/2026/2026-08-22.md')
    expect([...relations.transactions.keys()]).toContain('Finance/Transactions/Coffee.md')
  })

  it('does not sweep by date for a note that is not a journal', () => {
    useVault(JOURNAL_VAULT)
    configureAbele({ journals: [] })

    relations = relationsFor('Journals/2026/2026-08-22.md')
    expect([...relations.tasks.keys()]).toEqual([])
  })
})
