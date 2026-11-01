// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'vite'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'

it('omits unreachable schema construction while keeping reachable validation and its callbacks', async () => {
  const source = '/sample/node_modules/@abele/sync-sdk/dist/internal/protocol/sample.js'
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-schema',
        resolveId(id) {
          if (id === '/sample/entry.js' || id === source) return id
        },
        load(id) {
          if (id === '/sample/entry.js') return `export { UsedSchema } from '${source}'`
          if (id === source)
            return `const z={string(){globalThis.created++;return {parse(value){if(typeof value!=='string')throw new Error('invalid');return value}}}}; export const UsedSchema=/*#__PURE__*/z.string(); export const UnusedSchema=/*#__PURE__*/z.string(); export const NotReviewedSchema=z.string();`
        },
      },
    ],
    build: { write: false, minify: false, lib: { entry: '/sample/entry.js', formats: ['cjs'] } },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output)
  const module = { exports: {} as any },
    ctx = { module, exports: module.exports, created: 0 }
  runInNewContext(outputs.find((one) => one.type === 'chunk')!.code, ctx)
  // Only the explicitly annotated unused declaration is removable. The unreviewed
  // factory call retains its effect even though its export is unused.
  expect(ctx.created).toBe(2)
  expect(module.exports.UsedSchema.parse('sample')).toBe('sample')
  expect(() => module.exports.UsedSchema.parse(3)).toThrow('invalid')
})

it('never infers purity for parsing, global hooks, or validation callbacks', () => {
  // An explicit annotation only permits dropping the call it labels. These calls
  // deliberately remain unannotated and must retain their effects.
  const events: string[] = []
  runInNewContext(
    `const z = { string() { events.push('string'); return { refine(fn) { fn('sample'); return this }, parse() { events.push('parse') }, register() { events.push('register') } } }, config() { events.push('config') } }; const SampleSchema = z.string().refine(value => { z.string(); return value !== 'invalid' }); const parsed = SampleSchema.parse('sample'); z.config({}); SampleSchema.register({})`,
    { events }
  )
  expect(events).toEqual(['string', 'string', 'parse', 'config', 'register'])
})

it('does not parse non-JavaScript source formats with a schema purity transform', () => {
  const config = readFileSync(new URL('../../vite.config.mts', import.meta.url), 'utf8')
  expect(config).not.toContain('schemaPurityPlugin')
  expect(config).not.toContain('schema-purity')
})

it('does not infer purity from schema names or factory shapes', () => {
  const config = readFileSync(new URL('../../vite.config.mts', import.meta.url), 'utf8')
  expect(config).not.toContain('schemaPurityPlugin')
})
