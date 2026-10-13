/** Open the accepted settings row's local-node dialog before measuring its fields. */
export const OPEN_LOCAL_NODE_FORM = `
  const addLocalNode = settingsRoot.querySelector('button[aria-label="Name the node here and paste its token"]')
  if (!addLocalNode) throw Error('No local node action')
  addLocalNode.click()
  const nodeUrl = await until(() => settingsRoot.ownerDocument.querySelector('input[aria-label="Node URL"]'), 5000)
  if (!nodeUrl) throw Error('Local node fields did not open')
  const nodeForm = nodeUrl.closest('.modal')
  if (!nodeForm) throw Error('Local node dialog did not open')
`

/** Close only the child form, leaving settings available for the overview and session picker. */
export const CLOSE_LOCAL_NODE_FORM = `
  const cancelLocalNode = nodeForm.querySelector('button[aria-label="Close this and add nothing"]')
  if (!cancelLocalNode) throw Error('No local node cancel action')
  cancelLocalNode.click()
  if (!await until(() => !nodeForm.isConnected, 5000)) throw Error('Local node dialog did not close')
`
