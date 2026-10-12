import { describe, expect, it } from 'vitest'
import {
  buildTaskTree,
  parentsClosedBy,
  parentsReopenedBy,
  progressOf,
  type TreeNode,
} from '@/helpers/taskTree'

const t = (name: string, groups: string[] = [], done = false): TreeNode => ({
  path: `Tasks/${name}.md`,
  groups,
  done,
})

describe('subtasks from groups', () => {
  it('reopens only automatic ancestors and stops at a manually completed parent', () => {
    const top = t('Sample top', [], true)
    const parent = t('Sample parent', ['[[Sample top]]'], true)
    const child = t('Sample child', ['[[Sample parent]]'])
    const tree = buildTaskTree([top, parent, child], [top, parent, child])
    expect(
      parentsReopenedBy(
        tree,
        child,
        (n) => n.done,
        () => true
      )
    ).toEqual([parent, top])
    expect(
      parentsReopenedBy(
        tree,
        child,
        (n) => n.done,
        (n) => n === top
      )
    ).toEqual([])
  })

  it('never closes through a circular task, including its external parent', () => {
    const top = t('Sample top')
    const a = t('Sample first', ['[[Sample second]]', '[[Sample top]]'], true)
    const b = t('Sample second', ['[[Sample first]]'], true)
    const tree = buildTaskTree([top, a, b], [top, a, b])
    expect(parentsClosedBy(tree, a, (n) => n.done)).toEqual([])
    expect(
      parentsReopenedBy(
        tree,
        a,
        (n) => n.done,
        () => true
      )
    ).toEqual([])
  })
  it('keeps a parent link between distinct circles while flattening each circle', () => {
    const a = t('Sample upper one', ['[[Sample upper two]]'])
    const b = t('Sample upper two', ['[[Sample upper one]]'])
    const c = t('Sample lower one', ['[[Sample lower two]]', '[[Sample upper one]]'])
    const d = t('Sample lower two', ['[[Sample lower one]]'])
    const tree = buildTaskTree([a, b, c, d], [a, b, c, d])
    expect(tree.parents.get(c)).toEqual([a])
    expect(tree.children.get(a)).toEqual([c])
    expect(tree.roots).toEqual([a, b, d])
  })
  it('puts a subtask under each parent the list shows and counts its parent done of all', () => {
    const mount = t('Mount the station')
    const bracket = t('Print a bracket', ['[[Tasks/Mount the station|Mount the station]]'], true)
    const cable = t('Run the cable', ['[[Mount the station]]', '[[Garden]]'])
    const loose = t('Buy silica gel')
    const all = [mount, bracket, cable, loose]
    const tree = buildTaskTree([mount, cable, loose], all)

    expect(tree.roots).toEqual([mount, loose])
    expect(tree.children.get(mount)).toEqual([cable])
    expect(progressOf(tree, mount)).toEqual({ done: 1, total: 2 })
    expect(progressOf(tree, loose)).toBeNull()
  })

  it('leaves a subtask at the top when its parent is not in the list, naming the parent', () => {
    const mount = t('Mount the station')
    const cable = t('Run the cable', ['Tasks/Mount the station.md'])
    const tree = buildTaskTree([cable], [mount, cable])
    expect(tree.roots).toEqual([cable])
    expect(tree.parents.get(cable)).toEqual([mount])
  })

  it('shows a circle flat, tells each task in it, and closes nothing through it', () => {
    const a = t('Paint the shield', ['[[Seal the case]]'])
    const b = t('Seal the case', ['[[Paint the shield]]'])
    const self = t('Label the cables', ['[[Label the cables]]'])
    const tree = buildTaskTree([a, b, self], [a, b, self])
    expect(tree.roots).toEqual([a, b, self])
    expect(tree.circular.get(a)).toEqual([b])
    expect(tree.circular.get(self)).toEqual([self])
    expect(parentsClosedBy(tree, a, () => true)).toEqual([])
  })

  it('closes a parent once its last subtask is done, and on up', () => {
    const top = t('Weather station')
    const mount = t('Mount the station', ['[[Weather station]]'])
    const bracket = t('Print a bracket', ['[[Mount the station]]'], true)
    const cable = t('Run the cable', ['[[Mount the station]]'])
    const tree = buildTaskTree([top], [top, mount, bracket, cable])
    const done = new Set([bracket, cable])
    expect(parentsClosedBy(tree, cable, (x) => done.has(x))).toEqual([mount, top])
    done.delete(cable)
    expect(parentsClosedBy(tree, bracket, (x) => done.has(x))).toEqual([])
  })

  it('does not guess between two notes of one name in different folders', () => {
    const a = { path: 'Home/Paint.md', groups: [], done: false }
    const b = { path: 'Garden/Paint.md', groups: [], done: false }
    const c = t('Buy brushes', ['[[Paint]]'])
    expect(buildTaskTree([a, b, c], [a, b, c]).parents.get(c)).toEqual([])
  })
})
