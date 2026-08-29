/**
 * Markdown imported as text.
 *
 * Vite's own `vite/client` types declare this, but the plugin's tsconfig does not pull them in
 * — it compiles `src` alone. One line here is cheaper than widening the whole configuration.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}
