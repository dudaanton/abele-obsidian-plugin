/** Vite processes inline stylesheets as text without adding them to the global CSS asset. */
declare module '*.css?inline' {
  const text: string
  export default text
}
