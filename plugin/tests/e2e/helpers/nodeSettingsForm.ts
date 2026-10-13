/** Open the accepted settings row's local-node dialog before measuring its fields. */
export const OPEN_LOCAL_NODE_FORM = `
  const localNodeAction = () => [...settingsRoot.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent.trim() === 'Add the node on this computer')?.querySelector('button')
  await until(localNodeAction, 5000)
  const addLocalNode = localNodeAction()
  if (!addLocalNode) throw Error('No local node action')
  addLocalNode.click()
  if (!await until(() => settingsRoot.ownerDocument.querySelector('input[aria-label="Node URL"]'), 5000)) throw Error('Local node fields did not open')
  const nodeUrl = settingsRoot.ownerDocument.querySelector('input[aria-label="Node URL"]')
  const nodeForm = nodeUrl.closest('.modal')
  if (!nodeForm) throw Error('Local node dialog did not open')
`

/** Close only the child form, leaving settings available for the overview and session picker. */
export const CLOSE_LOCAL_NODE_FORM = `
  const cancelLocalNode = [...nodeForm.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')
  if (!cancelLocalNode) throw Error('No local node cancel action')
  cancelLocalNode.click()
  if (!await until(() => !nodeForm.isConnected, 5000)) throw Error('Local node dialog did not close')
`
