export const financeChartResizeFolder = 'SampleChartResize'

export function financeChartResizeFixture(currency: string, today: string): Record<string, string> {
  const note = (fields: Record<string, string | number>) =>
    '---\n' +
    Object.entries(fields)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n') +
    '\n---\n'
  return {
    'Sample wallet.md': note({ type: 'account', accountType: 'asset', currency }),
    'Sample spending.md': note({ type: 'account', accountType: 'expense' }),
    'Sample purchase.md': note({
      type: 'transaction',
      date: today,
      from: `[[${financeChartResizeFolder}/Sample wallet]]`,
      to: `[[${financeChartResizeFolder}/Sample spending]]`,
      amount: 25,
      currency,
    }),
  }
}
