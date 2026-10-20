/** Native suggestion selection shared by the live single-item and set-sharing cases. */
export const SHARE_SET_PICKER = `
const pickShareItem = async (box, label, waitForChip = true) => {
  const legacy = box.querySelector('select');
  if (legacy) {
    let option;
    await poll(() => { option = [...legacy.options].find(one => one.textContent.trim() === label); return !!option });
    legacy.value = option.value;
    legacy.dispatchEvent(new legacy.ownerDocument.defaultView.Event('change', { bubbles: true }));
    return;
  }
  const kind = label === 'Whole vault' ? 'vault' : label.startsWith('Folder: ') ? 'folder' : label.startsWith('Group: ') ? 'group' : 'file-text';
  const query = label === 'Whole vault' ? 'Whole vault' : label.replace(/^(Folder|Group|File): /, '');
  const name = query.split('/').pop().replace(/\\.md$/i, '');
  let input;
  await poll(() => (input = box.querySelector('.abele-share-picker input')) && !input.disabled);
  input.focus();
  typeInto(input, query);
  let choice;
  await poll(() => {
    choice = [...box.ownerDocument.querySelectorAll('.suggestion-item')].find(one =>
      one.querySelector('svg.lucide-' + kind) && one.textContent.includes(name) && one.getAttribute('aria-disabled') !== 'true');
    return !!choice;
  });
  choice.click();
  if (waitForChip) await poll(() => [...box.querySelectorAll('.multi-select-pill-content')].some(one => one.textContent.includes(name)));
};
`
