/** Stylesheets imported as text, for pages the reader writes into its frames. */
declare module '*.css?raw' {
  const text: string
  export default text
}
