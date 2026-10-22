import { build } from 'esbuild'
import { createRequire } from 'node:module'

/** Wrap a bundled package's module body so a single-file build can initialize it on demand. */
export function deferredPackagePlugin({ source, entry, exports: names, target, minify }) {
  const entryPath = entry ?? createRequire(import.meta.url).resolve(source)
  const virtualId = '\0abele-deferred:' + source
  for (const name of names)
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('Invalid deferred export: ' + name)
  return {
    name: 'abele-deferred-package',
    api: { source },
    enforce: 'pre',
    resolveId(id) {
      return id === source || id === entryPath ? virtualId : null
    },
    async load(id) {
      if (id !== virtualId) return null
      // CommonJS output is ordinary code nested in this function, never a string evaluated
      // at runtime. Rollup can inline the import while leaving initialization in the factory.
      const bundled = await build({
        entryPoints: [entryPath],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'browser',
        target,
        minify,
        legalComments: 'eof',
      })
      return `
        let instance;
        function packageModule() {
          if (instance === undefined) {
            const module = { exports: {} };
            ${bundled.outputFiles[0].text}
            instance = module.exports;
          }
          return instance;
        }
        ${names.map((name) => `export function ${name}(...args) { return packageModule()[${JSON.stringify(name)}](...args); }`).join('\n')}
      `
    },
  }
}
