/** Native suggestion selection shared by the live single-item and set-sharing cases. */
export const SHARE_SET_PICKER = `
const pickShareItem = async (box, label, waitForChip = true) => {
  const pickerRoot = () => box.matches('.abele-share-picker') ? box : box.querySelector('.abele-share-picker');
  let legacy = pickerRoot() ? null : box.querySelector('select');
  if (legacy) {
    let option;
    await poll(() => { legacy = box.querySelector('select'); option = legacy && [...legacy.options].find(one => one.textContent.trim() === label); return !!option }, undefined, 'sharing scopes to load');
    legacy.value = option.value;
    legacy.dispatchEvent(new legacy.ownerDocument.defaultView.Event('change', { bubbles: true }));
    return;
  }
  const kind = label === 'Whole vault' ? 'vault' : label.startsWith('Folder: ') ? 'folder' : label.startsWith('Group: ') ? 'group' : 'file';
  const query = label === 'Whole vault' ? 'Whole vault' : label.replace(/^(Folder|Group|File): /, '');
  const name = query.split('/').pop().replace(/\\.md$/i, '');
  let input;
  await poll(() => (input = box.querySelector('.abele-share-picker input')) && !input.disabled, undefined, 'Share picker: enabled search field');
  const tab = box.querySelector('[data-scope-kind="' + (kind === 'vault' ? 'folder' : kind) + '"]');
  tab?.click();
  await poll(() => !tab || tab.getAttribute('aria-pressed') !== 'false', undefined, 'Share picker: kind selected');
  let choice;
  const match = () => {
    // Kind changes, host focus and phone layout settle asynchronously. Reacquire
    // the live field rather than retaining a pre-render input or a blurred list.
    const picker = pickerRoot();
    input = picker?.querySelector('input');
    if (!input || input.disabled) return false;
    if (input.ownerDocument.activeElement !== input) input.focus();
    if (input.value !== query) typeInto(input, query);
    const inline = picker.querySelector('.abele-share-picker__results');
    if (picker.dataset.sharePickerMode === 'inline' && !inline) return false;
    choice = [...(inline || box.ownerDocument).querySelectorAll('.suggestion-item')].find(one =>
      one.dataset.shareKind === kind &&
      (kind === 'vault' ? one.dataset.sharePath === '/' : kind === 'group' && !query.includes('/') ? one.querySelector('.suggestion-title')?.textContent.trim() === name : one.dataset.sharePath === query) &&
      one.getAttribute('aria-disabled') !== 'true');
    return !!choice && choice.isConnected;
  };
  try { await poll(match, undefined, 'Share picker: matching suggestion row'); }
  catch (error) {
    const picker = pickerRoot();
    throw new Error(String(error?.message || error) + ': ' + JSON.stringify({
      mode: picker?.dataset.sharePickerMode, query: input?.value,
      focused: input?.ownerDocument.activeElement === input,
      sourceCount: picker?.dataset.sourceCount, sourcePaths: picker?.dataset.sourcePaths,
      selected: [...(picker?.querySelectorAll('.multi-select-pill') || [])].map(one=>one.dataset.path),
      rows: [...(picker?.querySelectorAll('.suggestion-item') || [])].map(one=>({kind:one.dataset.shareKind,path:one.dataset.sharePath,disabled:one.getAttribute('aria-disabled')}))
    }));
  }
  await poll(() => {
    if (!choice?.isConnected && !match()) return false;
    choice.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const win = choice.ownerDocument.defaultView;
    const viewport = win.visualViewport;
    const keyboard = parseFloat(win.getComputedStyle(choice.ownerDocument.documentElement).getPropertyValue('--keyboard-height')) || 0;
    const bottom = Math.min(win.innerHeight - keyboard, viewport ? viewport.offsetTop + viewport.height : win.innerHeight);
    const scroll = choice.closest('.modal-content');
    const before = choice.getBoundingClientRect();
    if (scroll && before.bottom > bottom - 8) scroll.scrollTop += before.bottom - bottom + 8;
    const rect = choice.getBoundingClientRect();
    return rect.height > 0 && rect.top >= (viewport?.offsetTop || 0) && rect.bottom <= bottom;
  }, undefined, 'Share picker: suggestion fully above keyboard');
  choice.click();
  if (waitForChip) await poll(() => [...box.querySelectorAll('.multi-select-pill-content')].some(one => one.textContent.includes(name)), undefined, 'Share picker: selected item chip');
};
`
