// Optional local UI preference, independent of the research envelope and backups.
export const LIBRARY_SELECTION_VERSION = 1;
export function selectedLibraryCollection(value, collections) {
  return value?.version === LIBRARY_SELECTION_VERSION && typeof value.collectionId === 'string'
    && collections.some(collection => collection.id === value.collectionId) ? value.collectionId : '';
}
export function explicitLibraryCollection(search) {
  const params = new URLSearchParams(search);
  return params.get('collectionId') ?? params.get('collection'); // Empty string explicitly means All Saved.
}
