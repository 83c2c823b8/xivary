// Optional local UI preference, separate from Library and research backups.
export const FOLLOWING_SELECTION_VERSION = 1;
export function selectedFollowingCollection(value, collections) {
  return value?.version === FOLLOWING_SELECTION_VERSION && typeof value.collectionId === 'string'
    && collections.some(collection => collection.id === value.collectionId) ? value.collectionId : '';
}
export function explicitFollowingCollection(search) {
  const params = new URLSearchParams(search);
  return params.get('collectionId') ?? params.get('collection'); // Empty string means All Following.
}
