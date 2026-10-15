import { orderedRecords } from './paper-ordering.js';

// Independent author orders; collection array order and global author slots are
// owned by their existing models. Missing manual orders use the global subsequence.
export function reconcileAuthorOrdering(state) {
  const input = state.authorOrdering;
  if (!input || input.version !== 1 || !Array.isArray(input.collectionOrders)
      || input.collectionOrders.some(order => !order || typeof order.collectionId !== 'string'
        || !Array.isArray(order.authorIds) || order.authorIds.some(id => typeof id !== 'string'))) {
    throw new Error('Invalid Following author ordering. Existing data was left unchanged.');
  }
  const collections = new Set(state.collections.map(collection => collection.id));
  const used = new Set(), collectionOrders = [];
  for (const order of input.collectionOrders) {
    if (!collections.has(order.collectionId) || used.has(order.collectionId)) continue;
    used.add(order.collectionId);
    const members = new Set(state.memberships.filter(member => member.collectionId === order.collectionId).map(member => member.authorId));
    const fallback = state.authors.filter(author => members.has(author.id)).map(author => author.id);
    collectionOrders.push({ collectionId: order.collectionId,
      authorIds: [...new Set([...order.authorIds.filter(id => members.has(id)), ...fallback])] });
  }
  return { version: 1, collectionOrders };
}

export function authorsInCollection(state, collectionId) {
  const members = new Set(state.memberships.filter(member => member.collectionId === collectionId).map(member => member.authorId));
  const authors = state.authors.filter(author => members.has(author.id));
  const order = state.authorOrdering.collectionOrders.find(order => order.collectionId === collectionId);
  return order ? orderedRecords(authors, order.authorIds) : authors;
}
