/** Invented membership oracle; expected results do not query the production index. */
export const JOURNAL_ORACLE_FOLDER = 'Sample journal oracle'
export const ORACLE_DAY = '2028-03-15'
export const ORACLE_NEXT_DAY = '2028-03-16'
export const journalOracleSpecs = [
  { name: 'Journals/2028-03-15', fm: { type: 'journal' } },
  { name: 'Other/2028-03-15', fm: { type: 'journal', created: ORACLE_DAY } },
  {
    name: 'Sample due task',
    fm: { type: 'task', due: ORACLE_DAY, date: ORACLE_NEXT_DAY, created: ORACLE_NEXT_DAY },
  },
  {
    name: 'Sample excluded task',
    fm: { type: 'task', due: '2028-03-17', date: ORACLE_DAY, created: ORACLE_DAY },
  },
  { name: 'Sample log', fm: { type: 'log', created: ORACLE_DAY } },
  {
    name: 'Sample payment',
    fm: { type: 'transaction', date: ORACLE_DAY, amount: 3, currency: 'XTS' },
  },
  {
    name: 'Sample time',
    fm: {
      type: 'time-entry',
      created: ORACLE_DAY,
      start: '2028-03-15 08:00:00',
      end: '2028-03-15 09:00:00',
    },
  },
  { name: 'Sample created note', fm: { type: 'note', created: ORACLE_DAY } },
  { name: 'Sample next note', fm: { type: 'note', due: ORACLE_NEXT_DAY, date: ORACLE_DAY } },
  { name: 'Sample invalid note', fm: { type: 'note', date: 'not-a-date' } },
] as const
export const oraclePath = (name: string) => `${JOURNAL_ORACLE_FOLDER}/${name}.md`
export const journalOracleExpected = {
  tasks: [oraclePath('Sample due task')],
  logs: [oraclePath('Sample log')],
  transactions: [oraclePath('Sample payment')],
  timeEntries: [oraclePath('Sample time')],
  notes: [oraclePath('Sample created note')],
}
export const journalOracleNextExpected = {
  tasks: [oraclePath('Sample due task')],
  logs: [],
  transactions: [],
  timeEntries: [],
  notes: [oraclePath('Sample created note'), oraclePath('Sample next note')].sort(),
}
