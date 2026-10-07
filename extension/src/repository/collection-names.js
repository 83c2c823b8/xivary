/** Apply the same deterministic display-name collision policy everywhere
 * collections from independent sources are combined. Callers provide ID order.
 */
export function disambiguateCollectionNames(collections) {
  const reserved = new Set(collections.map(collection => collection.name.toLowerCase()));
  const used = new Set();
  for (const collection of collections) {
    const original = collection.name;
    for (let index = 2; used.has(collection.name.toLowerCase()); index++) {
      const suffix = ` (${index})`;
      collection.name = original.slice(0, 80 - suffix.length).trimEnd() + suffix;
      if (reserved.has(collection.name.toLowerCase())) collection.name = original;
    }
    used.add(collection.name.toLowerCase());
  }
  return collections;
}
