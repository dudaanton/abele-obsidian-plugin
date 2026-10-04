export interface RecipientRowExpectation {
  section: string
  name: string
  recipient: string
  actions: string[]
  warning?: string
}

const HTTP_WARNING = 'Unencrypted: anyone on the network path can read the key.'
export const RECIPIENT_ROWS: RecipientRowExpectation[] = [
  {
    section: 'Key permissions',
    name: 'Sample secure key',
    recipient: 'https://keys.sample.example',
    actions: ['Allow on this device', 'Remove key permission'],
  },
  {
    section: 'Key permissions',
    name: 'Sample local key',
    recipient: 'http://192.168.54.12:8123',
    actions: ['Allow unencrypted HTTP', 'Remove key permission'],
    warning: HTTP_WARNING,
  },
  {
    section: 'Service destinations to confirm',
    name: 'Sample secure provider',
    recipient: 'https://api.sample.example',
    actions: ['Allow on this device'],
  },
  {
    section: 'Service destinations to confirm',
    name: 'Sample home provider',
    recipient: 'http://192.168.8.20:1234',
    actions: ['Allow unencrypted HTTP'],
    warning: HTTP_WARNING,
  },
  {
    section: 'HTTP transport on this device',
    name: 'http://192.168.54.14:8125',
    recipient: 'http://192.168.54.14:8125',
    actions: ['Remove HTTP exception'],
    warning: 'Unencrypted transport only; each key still needs its own recipient permission.',
  },
]

export interface RecipientAction {
  text: string
  focused: boolean
  reachable: boolean
  contextVisible: boolean
  inViewport: boolean
  clipped: string[]
}

export interface RecipientActionRow {
  section: string
  name: string
  recipient: string
  description: string
  actions: RecipientAction[]
}

export interface RecipientLayoutReport {
  rows: RecipientActionRow[]
  bodyActions: string[]
  unpairedActions: string[]
}

/** Exact row identities and controls, not an allowance for arbitrary buttons in the body. */
export function recipientRowFailures(
  report: RecipientLayoutReport,
  expected: RecipientRowExpectation[]
): string[] {
  const failures: string[] = []
  if (report.rows.length !== expected.length) failures.push('recipient row count')
  if (report.unpairedActions.length) failures.push('actions without a recipient row')
  if (
    JSON.stringify(report.bodyActions) !==
    JSON.stringify(report.rows.flatMap((row) => row.actions.map((action) => action.text)))
  )
    failures.push('body actions do not match paired actions')
  for (const [index, wanted] of expected.entries()) {
    const row = report.rows[index]
    if (!row) {
      failures.push(`missing row ${wanted.name}`)
      continue
    }
    const label = wanted.name
    if (row.section !== wanted.section) failures.push(`${label}: section`)
    if (row.name !== wanted.name) failures.push(`${label}: name`)
    if (row.recipient !== wanted.recipient) failures.push(`${label}: recipient`)
    if (!row.description.includes(wanted.recipient) && row.name !== wanted.recipient)
      failures.push(`${label}: recipient not in its visible context`)
    if (wanted.warning && !row.description.includes(wanted.warning))
      failures.push(`${label}: warning`)
    if (JSON.stringify(row.actions.map((action) => action.text)) !== JSON.stringify(wanted.actions))
      failures.push(`${label}: action names or cardinality`)
    for (const action of row.actions) {
      if (!action.focused) failures.push(`${label}: ${action.text} cannot focus`)
      if (!action.reachable) failures.push(`${label}: ${action.text} cannot be reached`)
      if (!action.contextVisible)
        failures.push(`${label}: ${action.text} lost its recipient context`)
      if (!action.inViewport) failures.push(`${label}: ${action.text} outside screen`)
      if (action.clipped.length) failures.push(`${label}: ${action.text} focus ring clipped`)
    }
  }
  return failures
}
