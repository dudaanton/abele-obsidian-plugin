/**
 * The query of a list of pull requests, issues or discussions: GitHub's search syntax is the one
 * source of truth, and the filters only rewrite it.
 */
import { describe, it, expect } from 'vitest'
import {
  qualifier,
  searchQuery,
  setQualifier,
  sortOf,
  stateOf,
  tokens,
  withState,
} from '@/github/lists/listQuery'

describe('reading a query', () => {
  it('keeps a quoted value whole', () => {
    expect(tokens('is:open label:"good first issue" crash')).toEqual([
      'is:open',
      'label:"good first issue"',
      'crash',
    ])
    expect(qualifier('label:bug label:"good first issue"', 'label')).toEqual([
      'bug',
      'good first issue',
    ])
  })

  it('tells the state', () => {
    expect(stateOf('is:pr is:open')).toBe('open')
    expect(stateOf('is:pr is:merged')).toBe('merged')
    expect(stateOf('is:issue is:closed')).toBe('closed')
    expect(stateOf('is:pr')).toBe('all')
  })

  it('takes the sort apart, newest first unless said', () => {
    expect(sortOf('is:open sort:updated-desc')).toEqual({ sort: 'updated', order: 'desc' })
    expect(sortOf('sort:created-asc')).toEqual({ sort: 'created', order: 'asc' })
    expect(sortOf('is:open')).toEqual({ sort: 'created', order: 'desc' })
    expect(sortOf('sort:nonsense')).toEqual({ sort: 'created', order: 'desc' })
  })
})

describe('the filters rewriting it', () => {
  it('set one value in place of the ones before', () => {
    expect(setQualifier('is:open author:ann crash', 'author', 'bob')).toBe(
      'is:open crash author:bob'
    )
    expect(setQualifier('is:open author:ann', 'author', null)).toBe('is:open')
    expect(setQualifier('is:open', 'label', 'good first issue')).toBe(
      'is:open label:"good first issue"'
    )
  })

  it('change the state without losing the kind or a draft', () => {
    expect(withState('is:pr is:open draft:true', 'closed')).toBe('is:pr draft:true is:closed')
    expect(withState('is:pr is:closed', 'merged')).toBe('is:pr is:merged')
    expect(withState('is:issue is:open', 'all')).toBe('is:issue')
  })
})

describe('what GitHub is asked', () => {
  it('names the repository and the kind, and leaves the sort to its own parameters', () => {
    expect(searchQuery('pulls', 'o/r', 'is:open sort:updated-desc label:bug')).toBe(
      'repo:o/r is:pr is:open label:bug'
    )
    expect(searchQuery('issues', 'o/r', 'is:issue is:closed')).toBe('repo:o/r is:issue is:closed')
  })

  it('keeps a pull request list to pull requests whatever was typed', () => {
    expect(searchQuery('pulls', 'o/r', 'is:issue crash')).toBe('repo:o/r is:pr crash')
    expect(searchQuery('issues', 'o/r', 'is:pr repo:x/y')).toBe('repo:o/r is:issue')
  })
})
