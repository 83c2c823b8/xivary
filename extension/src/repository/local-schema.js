import { createPaper } from '../domain/paper.js';
import { createAuthor } from '../domain/author.js';
import { cleanText, normalizeArxivId } from '../domain/identifiers.js';
import { reconcilePaperOrdering } from '../domain/paper-ordering.js';
import { normalizeCachedAuthorResults } from '../services/arxiv-paper-service.js';

export const STORAGE_SCHEMA_VERSION = 6;
const DEFAULT_PAPER_COLLECTION_ID = 'paper-collection:saved-papers';
export const SETTINGS_DEFAULTS = Object.freeze({lastUsedAuthorCollectionId:null,lastUsedPaperCollectionId:null,
  openXivaryFromToolbarInNewTab:true,openAuthorResultsInNewTab:true,openArxivLinksInNewTab:false,
  organizeFollowedAuthorsIntoCollections:false,renderLatexInAbstracts:true,vimMode:false,customLatexMacros:''});
function defaults(state) {
  if (state.settings === undefined) state.settings = {};
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) throw new Error('Invalid settings. Existing data was left unchanged.');
  for (const [key,value] of Object.entries(SETTINGS_DEFAULTS)) if (state.settings[key] === undefined) state.settings[key] = value;
}
function legacyCollections(state, now) {
  if (['authors','collections','memberships'].some(key=>state[key]!==undefined)) throw new Error('Partially migrated author collections. Existing data was left unchanged.');
  state.authors=state.following;
  state.collections=[{id:'collection:following',name:'Following',createdAt:now,updatedAt:now}];
  state.memberships=state.authors.map(author=>({authorId:author.id,collectionId:'collection:following',addedAt:author.followedAt,updatedAt:author.updatedAt}));
  defaults(state);state.settings.lastUsedAuthorCollectionId='collection:following';delete state.following;
}
// Every step advances exactly one persisted data-schema version. No manifest coupling.
export const STORAGE_MIGRATIONS = new Map([
  [1,(state)=>{if(!Array.isArray(state.following))throw new Error('Invalid followed author data.');state.following=migrateFollowing(state.following);}],
  [2,(state,now)=>{if(!Array.isArray(state.following))throw new Error('Invalid followed author data.');legacyCollections(state,now);}],
  [3,(state)=>{if(state.authorPaperCaches===undefined)state.authorPaperCaches=[];}],
  [4,(state,now)=>{
    if(state.paperCollections===undefined && state.paperMemberships===undefined){
      state.paperCollections=[{id:DEFAULT_PAPER_COLLECTION_ID,name:'Saved Papers',createdAt:now,updatedAt:now}];
      state.paperMemberships=state.favorites.map(paper=>({arxivId:paper.arxivId,collectionId:DEFAULT_PAPER_COLLECTION_ID,addedAt:paper.savedAt,updatedAt:paper.updatedAt}));
      defaults(state);state.settings.lastUsedPaperCollectionId=DEFAULT_PAPER_COLLECTION_ID;
    } else if(state.paperCollections===undefined || state.paperMemberships===undefined)throw new Error('Partially migrated paper collections. Existing data was left unchanged.');
  }],
  [5,(state)=>{
    defaults(state);
    if(!Array.isArray(state.paperCollections)||!Array.isArray(state.paperMemberships))throw new Error('Invalid paper collection data. Existing data was left unchanged.');
    const input=state.paperOrdering;
    if(input!==undefined){
      if(!input || input.version!==1)throw new Error('Invalid Library ordering. Existing data was left unchanged.');
      if(input.collectionIds===undefined)input.collectionIds=state.paperCollections.map(collection=>collection.id);
      if(input.paperOrders===undefined)input.paperOrders=[];
    }
    state.paperOrdering=reconcilePaperOrdering(state);
  }],
]);
export function freshState(now) {
  return {schemaVersion:STORAGE_SCHEMA_VERSION,favorites:[],authors:[],collections:[],memberships:[],authorPaperCaches:[],
    paperCollections:[{id:DEFAULT_PAPER_COLLECTION_ID,name:'Saved Papers',createdAt:now,updatedAt:now}],paperMemberships:[],
    settings:{...SETTINGS_DEFAULTS,lastUsedPaperCollectionId:DEFAULT_PAPER_COLLECTION_ID},
    paperOrdering:{version:1,collectionIds:[DEFAULT_PAPER_COLLECTION_ID],paperOrders:[]}};
}
export function prepareState(stored,now) {
  const state=stored===undefined?freshState(now):structuredClone(stored);
  if(!state || !Number.isInteger(state.schemaVersion) || state.schemaVersion<1 || state.schemaVersion>STORAGE_SCHEMA_VERSION || !Array.isArray(state.favorites))throw new Error('Unsupported or damaged library data. Existing data was left unchanged.');
  // Validate papers before any step could derive memberships from them.
  for(const paper of state.favorites){const expected=createPaper(paper,paper.savedAt);if(expected.arxivId!==paper.arxivId || !validDate(paper.savedAt)||!validDate(paper.updatedAt))throw new Error('Invalid saved paper data.');}
  while(state.schemaVersion<STORAGE_SCHEMA_VERSION){
    const step=STORAGE_MIGRATIONS.get(state.schemaVersion);if(!step)throw new Error('No safe storage migration is registered.');
    step(state,now);state.schemaVersion++;
  }
  return validateCurrentState(state);
}
export function validateCurrentState(state) {
  if (!state || state.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(state.favorites)) {
    throw new Error("Unsupported or damaged library data. Existing data was left unchanged.");
  }
  for (const paper of state.favorites) {
    const validated = createPaper(paper, paper.savedAt);
    if (paper.arxivId !== validated.arxivId || !validDate(paper.savedAt) || !validDate(paper.updatedAt)) {
      throw new Error("Invalid saved paper data.");
    }
  }
  if (![state.authors, state.collections, state.memberships].every(Array.isArray) || !state.settings) {
    throw new Error("Invalid author collection data.");
  }
  if (typeof state.settings.vimMode !== "boolean") throw new Error("Invalid Vim Mode preference.");
  if (typeof state.settings.renderLatexInAbstracts !== "boolean") throw new Error("Invalid LaTeX rendering preference.");
  if (typeof state.settings.customLatexMacros !== "string") throw new Error("Invalid LaTeX macro preference.");
  if (typeof state.settings.openXivaryFromToolbarInNewTab !== "boolean") throw new Error("Invalid toolbar navigation preference.");
  if (typeof state.settings.openAuthorResultsInNewTab !== "boolean") throw new Error("Invalid author navigation preference.");
  if (typeof state.settings.openArxivLinksInNewTab !== "boolean") throw new Error("Invalid link preference.");
  if (typeof state.settings.organizeFollowedAuthorsIntoCollections !== "boolean") throw new Error("Invalid author collection preference.");
  const authorIds = new Set();
  for (const author of state.authors) {
    const validated = createAuthor(author, author.followedAt);
    if (author.id !== validated.id || author.normalizedName !== validated.normalizedName
        || !validDate(author.followedAt) || !validDate(author.updatedAt) || authorIds.has(author.id)) {
      throw new Error("Invalid followed author data.");
    }
    authorIds.add(author.id);
  }
  const collectionIds = new Set();
  for (const collection of state.collections) {
    if (typeof collection.id !== "string" || !collection.id.startsWith("collection:")
        || collectionIds.has(collection.id) || !validDate(collection.createdAt) || !validDate(collection.updatedAt)) {
      throw new Error("Invalid collection data.");
    }
    collectionName(state, collection.name, collection.id);
    collectionIds.add(collection.id);
  }
  const pairs = new Set();
  for (const item of state.memberships) {
    const key = JSON.stringify([item.authorId, item.collectionId]);
    if (!authorIds.has(item.authorId) || !collectionIds.has(item.collectionId) || pairs.has(key)
        || !validDate(item.addedAt) || !validDate(item.updatedAt)) throw new Error("Invalid collection membership.");
    pairs.add(key);
  }
  const lastUsed = state.settings.lastUsedAuthorCollectionId;
  if (lastUsed !== null && !collectionIds.has(lastUsed)) throw new Error("Invalid last-used collection.");
  if (!Array.isArray(state.authorPaperCaches)) throw new Error("Invalid author paper cache data.");
  state.authorPaperCaches = state.authorPaperCaches.map(normalizeCachedAuthorResults);
  if (!Array.isArray(state.paperCollections) || !Array.isArray(state.paperMemberships)) {
    throw new Error("Invalid paper collection data.");
  }
  const paperIds = new Set(state.favorites.map(paper => paper.arxivId));
  if (paperIds.size !== state.favorites.length) throw new Error('Duplicate saved paper IDs. Existing data was left unchanged.');
  const paperCollectionIds = new Set();
  for (const collection of state.paperCollections) {
    if (typeof collection.id !== "string" || !collection.id.startsWith("paper-collection:")
        || paperCollectionIds.has(collection.id) || !validDate(collection.createdAt) || !validDate(collection.updatedAt)) {
      throw new Error("Invalid paper collection data.");
    }
    paperCollectionName(state, collection.name, collection.id);
    paperCollectionIds.add(collection.id);
  }
  const paperPairs = new Set();
  for (const item of state.paperMemberships) {
    const key = JSON.stringify([item.arxivId, item.collectionId]);
    if (!paperIds.has(item.arxivId) || !paperCollectionIds.has(item.collectionId) || paperPairs.has(key)
        || !validDate(item.addedAt) || !validDate(item.updatedAt)) throw new Error("Invalid paper collection membership.");
    paperPairs.add(key);
  }
  for (const paperId of paperIds) {
    if (!state.paperMemberships.some(item => item.arxivId === paperId)) throw new Error("Saved paper has no collection membership.");
  }
  const lastUsedPaper = state.settings.lastUsedPaperCollectionId;
  if (lastUsedPaper !== null && !paperCollectionIds.has(lastUsedPaper)) throw new Error("Invalid last-used paper collection.");
  if (state.paperOrdering === undefined) throw new Error('Missing Library ordering in current storage. Existing data was left unchanged.');
  state.paperOrdering = reconcilePaperOrdering(state);
  return state;
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** One-time schema 1 -> 2 migration. Favorites are deliberately not rewritten. */
function migrateFollowing(authors) {
  const merged = new Map();
  for (const author of authors) {
    const oldName = cleanText(author.displayName, "Author name").toLowerCase();
    const paperId = normalizeArxivId(author.sourceArxivId);
    const index = author.sourceAuthorIndex;
    const oldId = `arxiv-author:v1:${paperId}:${index}:${encodeURIComponent(oldName)}`;
    if (!Number.isSafeInteger(index) || index < 0 || author.id !== oldId
        || !validDate(author.followedAt) || !validDate(author.updatedAt)) {
      throw new Error("Invalid followed author data. Migration left existing data unchanged.");
    }
    const { sourceArxivId, sourceAuthorIndex, ...retained } = author;
    const canonical = {
      ...retained,
      ...createAuthor(author, author.followedAt),
      updatedAt: author.updatedAt,
    };
    const previous = merged.get(canonical.id);
    if (!previous) {
      merged.set(canonical.id, canonical);
      continue;
    }
    // Latest updated record supplies the spelling and optional fields; ties keep
    // the first stored record. Preserve the earliest time the author was followed.
    const core = new Set(['id','displayName','normalizedName','followedAt','updatedAt']);
    for (const key of Object.keys(canonical)) {
      if (!core.has(key) && previous[key] !== undefined && canonical[key] !== undefined && JSON.stringify(previous[key]) !== JSON.stringify(canonical[key])) {
        throw new Error('Conflicting legacy author metadata. Existing data was left unchanged.');
      }
    }
    const winner = Date.parse(canonical.updatedAt) > Date.parse(previous.updatedAt) ? canonical : previous;
    merged.set(canonical.id, {
      ...previous, ...canonical, ...winner,
      followedAt: Date.parse(canonical.followedAt) < Date.parse(previous.followedAt)
        ? canonical.followedAt : previous.followedAt,
    });
  }
  return [...merged.values()];
}

export function collectionName(state, value, exceptId) {
  const name = cleanText(value, "Collection name");
  if (name.length > 80) throw new Error("Collection names must be at most 80 characters.");
  if (state.collections.some(item => item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A collection with this name already exists.");
  }
  return name;
}

export function paperCollectionName(state, value, exceptId) {
  const name = cleanText(value, "Collection name");
  if (name.length > 80) throw new Error("Collection names must be at most 80 characters.");
  if (state.paperCollections.some(item => item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A collection with this name already exists.");
  }
  return name;
}
