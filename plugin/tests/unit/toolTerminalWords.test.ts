import { expect, it } from 'vitest'
import { toolResultText } from '@/ai/toolLine'
it('renders terminal output without colour controls, including JSON string results', () => {
  const output = '\u001b[41mBuild failed\u001b[0m'
  expect(toolResultText(output)).toBe('Build failed')
  expect(toolResultText(JSON.stringify({ output }))).toBe('Output: Build failed')
})
