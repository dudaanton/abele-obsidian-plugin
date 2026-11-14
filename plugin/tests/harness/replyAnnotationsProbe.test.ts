import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { modalMotion } from '../e2e/helpers/modalMotion'

it('compiles the actual reply annotation page script including its failure diagnostic', () => {
  const source = readFileSync(resolve(__dirname, '../e2e/replyAnnotations.e2e.test.ts'), 'utf8')
  const template = source.match(/const script = `([\s\S]*?)`\n/)![1]
  const script = new Function('path', 'shots', 'modalMotion', `return \`${template}\``)(
    'sample-chat.abchat',
    'sample-shots',
    modalMotion
  )
  expect(() => new Function(`return ${script}`)).not.toThrow()
})
