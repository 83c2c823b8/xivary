// Local, ID-based Library presentation. No metadata, membership or sync ownership.
export function reconcilePaperOrdering(state) {
  const input = state.paperOrdering;
  if (input !== undefined && (!input || input.version !== 1 || !Array.isArray(input.collectionIds)
      || input.collectionIds.some(id => typeof id !== 'string') || !Array.isArray(input.paperOrders)
      || input.paperOrders.some(order => !order || typeof order.collectionId !== 'string' || !Array.isArray(order.paperIds) || order.paperIds.some(id => typeof id !== 'string')))) {
    throw new Error('Invalid Library ordering. Existing data was left unchanged.');
  }
  const collections = state.paperCollections.map(item => item.id), valid = new Set(collections);
  const collectionIds = [...new Set([...(input?.collectionIds || []).filter(id => valid.has(id)), ...collections])];
  const membership = new Map(collections.map(id => [id, new Set()]));
  for (const item of state.paperMemberships) membership.get(item.collectionId)?.add(item.arxivId);
  const used = new Set(), paperOrders = [];
  for (const order of input?.paperOrders || []) {
    if (!valid.has(order.collectionId) || used.has(order.collectionId)) continue;
    used.add(order.collectionId);
    const members = membership.get(order.collectionId);
    const fallback = state.favorites.filter(paper => members.has(paper.arxivId)).map(paper => paper.arxivId);
    paperOrders.push({ collectionId: order.collectionId, paperIds: [...new Set([...order.paperIds.filter(id => members.has(id)), ...fallback])] });
  }
  return { version: 1, collectionIds, paperOrders };
}

export function moveBefore(ids, id, beforeId) {
  if (!ids.includes(id) || (beforeId !== null && !ids.includes(beforeId))) throw new Error('The item or drop target changed. Try again.');
  if (beforeId === id) return [...ids];
  const next = ids.filter(item => item !== id), index = beforeId === null ? next.length : next.indexOf(beforeId);
  next.splice(index, 0, id); return next;
}

export function orderedRecords(records, ids) {
  const byId = new Map(records.map(record => [record.arxivId ?? record.id, record]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}
