/**
 * Reading the links out of a message, so the agent can be told where they point.
 *
 * Both of Obsidian's link forms are read, since "Chat about this" writes whichever the vault
 * is set to; web addresses are not links into the vault and are left alone.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { App } from 'obsidian'
import { linkTargets, linkedNotesNote } from '@/ai/linkedNotes'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

beforeEach(() => {
  app = useVault([
    { path: 'Projects/Budget.md', content: '' },
    { path: 'Projects/My Plan.md', content: '' },
    { path: 'Media/chart.png', content: '' },
  ])
})

describe('the links in a message', () => {
  it('reads wikilinks with a heading, a block or an alias, and embeds', () => {
    expect(
      linkTargets('[[Budget#Q3]] and [[My Plan|the plan]], [[Budget^x1]], ![[chart.png]]')
    ).toEqual(['Budget', 'My Plan', 'chart.png'])
  })

  it('reads markdown links, decoded, and skips web addresses', () => {
    expect(
      linkTargets('[plan](Projects/My%20Plan.md#goals) and [site](https://example.com/x.md)')
    ).toEqual(['Projects/My Plan.md'])
  })
})

describe('what the model is told', () => {
  it('names the path of each link the chat can reach', () => {
    const scope = new ScopeResolver()
    scope.setFullVaultAccess(true)

    const note = linkedNotesNote('[[Budget]] and [[My Plan]]', app as unknown as App, scope)

    expect(note).toContain('"Budget" is Projects/Budget.md')
    expect(note).toContain('"My Plan" is Projects/My Plan.md')
  })

  it('says nothing when there is nothing to explain', () => {
    const scope = new ScopeResolver()
    scope.setFullVaultAccess(true)

    expect(linkedNotesNote('no links here', app as unknown as App, scope)).toBe('')
    expect(linkedNotesNote('[[Missing]]', app as unknown as App, scope)).toBe('')
    // Already written as the path.
    expect(linkedNotesNote('[[Projects/Budget]]', app as unknown as App, scope)).toBe('')
  })

  it('leaves out what the chat cannot reach', () => {
    const scope = new ScopeResolver()
    scope.addFile('Projects/Budget.md')

    const note = linkedNotesNote('[[Budget]] and [[My Plan]]', app as unknown as App, scope)

    expect(note).toContain('Projects/Budget.md')
    expect(note).not.toContain('My Plan')
  })
})
