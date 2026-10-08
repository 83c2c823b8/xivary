/** Cancel before outside activation, without detaching its target or stealing focus. */
export function bindCollectionRenameOutside({ getForm, isBusy, cancel, document: surface = document }) {
  surface.addEventListener("pointerdown", event => {
    const form = getForm();
    if (!form || isBusy() || form.contains(event.target)) return;
    cancel(); // The page replaces only the edited row; the outside click continues.
  }, true);
}
