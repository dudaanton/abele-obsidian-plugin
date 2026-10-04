import { describe, expect, it } from 'vitest'
import {
  recipientRowFailures,
  type RecipientLayoutReport,
  type RecipientRowExpectation,
} from '../helpers/keyDestinationLayout'

const wanted: RecipientRowExpectation[] = [
  {
    section: 'Key permissions',
    name: 'Sample local key',
    recipient: 'http://192.168.54.12:8123',
    actions: ['Allow unencrypted HTTP', 'Remove key permission'],
    warning: 'Unencrypted: anyone on the network path can read the key.',
  },
]
const sample = (): RecipientLayoutReport => ({
  rows: [
    {
      ...wanted[0],
      description: wanted[0].recipient + ' — ' + wanted[0].warning,
      actions: wanted[0].actions.map((text) => ({
        text,
        focused: true,
        reachable: true,
        contextVisible: true,
        inViewport: true,
        clipped: [],
      })),
    },
  ],
  bodyActions: [...wanted[0].actions],
  unpairedActions: [],
})

describe('recipient-row layout contract guards', () => {
  it('accepts only the complete expected association and action geometry', () => {
    expect(recipientRowFailures(sample(), wanted)).toEqual([])
  })
  it.each(['section', 'name', 'recipient'] as const)('rejects a mismatched %s', (field) => {
    const report = sample()
    report.rows[0][field] = 'unrelated sample'
    expect(recipientRowFailures(report, wanted)).toContain(`Sample local key: ${field}`)
  })
  it('rejects a detached recipient and an absent HTTP warning', () => {
    const report = sample()
    report.rows[0].description = 'Unrelated context'
    expect(recipientRowFailures(report, wanted)).toContain(
      'Sample local key: recipient not in its visible context'
    )
    expect(recipientRowFailures(report, wanted)).toContain('Sample local key: warning')
  })
  it('rejects an unpaired or extra body action', () => {
    const report = sample()
    report.unpairedActions.push('Allow unrelated address')
    report.bodyActions.push('Allow unrelated address')
    expect(recipientRowFailures(report, wanted)).toContain('actions without a recipient row')
    expect(recipientRowFailures(report, wanted)).toContain(
      'body actions do not match paired actions'
    )
  })
  it.each(['missing', 'duplicate', 'extra'])('rejects a %s recipient row', (change) => {
    const report = sample()
    if (change === 'missing') report.rows = []
    else report.rows.push(structuredClone(report.rows[0]))
    expect(recipientRowFailures(report, wanted)).toContain('recipient row count')
  })
  it('rejects wrong or duplicate actions, even with the right label and recipient', () => {
    const report = sample()
    report.rows[0].actions.push({ ...report.rows[0].actions[0] })
    expect(recipientRowFailures(report, wanted)).toContain(
      'Sample local key: action names or cardinality'
    )
  })
  it.each(['focused', 'reachable', 'contextVisible', 'inViewport'] as const)(
    'rejects a failed %s measurement',
    (field) => {
      const report = sample()
      report.rows[0].actions[0][field] = false
      expect(recipientRowFailures(report, wanted)).not.toEqual([])
    }
  )
  it('rejects a clipped focus ring', () => {
    const report = sample()
    report.rows[0].actions[0].clipped = ['sample clipping ancestor']
    expect(recipientRowFailures(report, wanted)).toContain(
      'Sample local key: Allow unencrypted HTTP focus ring clipped'
    )
  })
})
