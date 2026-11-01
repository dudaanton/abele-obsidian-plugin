exports.enableAfterProfile = async function (ready, enable) {
  await ready
  return enable()
}
