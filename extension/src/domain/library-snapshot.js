import { createPaper } from './paper.js';
import { cleanText } from './identifiers.js';
import { reconcilePaperOrdering } from './paper-ordering.js';

export const LIBRARY_SNAPSHOT_VERSION = 2;
/** Explicit RPC v1 -> v2 migration, separate from persisted storage migrations.
 * A stale worker can return the old DTO while a newly loaded page uses new JS.
 * Validate real records/references before deriving their known prior ordering.
 */
export function normalizeLibrarySnapshot(input) {
  const fail = message => { throw new Error(`${message} Stored data was left unchanged. Reload Xivary to retry.`); };
  if(!input || ![undefined,LIBRARY_SNAPSHOT_VERSION].includes(input.snapshotVersion)
      || ![input.papers,input.collections,input.memberships].every(Array.isArray) || !input.settings || typeof input.settings!=='object') fail('Unsupported Library response.');
  const legacy=input.snapshotVersion===undefined;
  if(!legacy && input.ordering===undefined)fail('Missing ordering in the current Library response.');
  const paperIds=new Set(),collectionIds=new Set(),names=new Set(),pairs=new Set();
  const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  for(const paper of input.papers){const normalized=createPaper(paper,paper.savedAt);if(normalized.arxivId!==paper.arxivId || paperIds.has(paper.arxivId)||!date(paper.savedAt)||!date(paper.updatedAt))fail('Invalid Library paper.');paperIds.add(paper.arxivId);}
  for(const collection of input.collections){if(typeof collection.id!=='string'||!collection.id.startsWith('paper-collection:')||collectionIds.has(collection.id)||!date(collection.createdAt)||!date(collection.updatedAt))fail('Invalid Library collection.');const name=cleanText(collection.name,'Collection name');if(name.length>80||names.has(name.toLowerCase()))fail('Invalid Library collection name.');collectionIds.add(collection.id);names.add(name.toLowerCase());}
  for(const member of input.memberships){const key=JSON.stringify([member.arxivId,member.collectionId]);if(!paperIds.has(member.arxivId)||!collectionIds.has(member.collectionId)||pairs.has(key)||!date(member.addedAt)||!date(member.updatedAt))fail('Invalid Library membership.');pairs.add(key);}
  for(const id of paperIds)if(!input.memberships.some(member=>member.arxivId===id))fail('Library paper has no collection membership.');
  if(typeof input.settings.openArxivLinksInNewTab!=='boolean')fail('Invalid Library settings.');
  const ordering=reconcilePaperOrdering({favorites:input.papers,paperCollections:input.collections,paperMemberships:input.memberships,paperOrdering:input.ordering});
  return structuredClone({...input,snapshotVersion:LIBRARY_SNAPSHOT_VERSION,ordering});
}
