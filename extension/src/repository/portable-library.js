import { createAuthor } from "../domain/author.js";
import { cleanText, isoDate } from "../domain/identifiers.js";
import { createPaper } from "../domain/paper.js";
import { disambiguateCollectionNames } from "./collection-names.js";

export const PORTABLE_FORMAT = "xivary-library";
export const PORTABLE_VERSION = 1;
export const SCOPED_PORTABLE_VERSION = 2;
export const PORTABLE_CATEGORIES = ["bookmarks", "following"];
export const MAX_IMPORT_LENGTH = 10 * 1024 * 1024;

const TOP_LEVEL_FIELDS = ["format", "version", "exportedAt", "papers", "paperCollections",
  "paperMemberships", "authors", "authorCollections", "authorMemberships", "preferences"];
const PAPER_FIELDS = ["arxivId", "title", "authors", "savedAt", "updatedAt", "tags", "note", "read",
  "categories", "abstract", "publishedAt"];
const AUTHOR_FIELDS = ["id", "displayName", "normalizedName", "followedAt", "updatedAt"];
const COLLECTION_FIELDS = ["id", "name", "createdAt", "updatedAt"];
const PAPER_MEMBERSHIP_FIELDS = ["arxivId", "collectionId", "addedAt", "updatedAt"];
const AUTHOR_MEMBERSHIP_FIELDS = ["authorId", "collectionId", "addedAt", "updatedAt"];
const PREFERENCE_FIELDS = ["openArxivLinksInNewTab", "organizeFollowedAuthorsIntoCollections"];
const CATEGORY_FIELDS = {
  bookmarks: ["papers", "paperCollections", "paperMemberships"],
  following: ["authors", "authorCollections", "authorMemberships"],
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sameFields = (value, expected) => isObject(value)
  && Object.keys(value).length === expected.length
  && expected.every(field => Object.hasOwn(value, field));
const earliest = (a, b) => Date.parse(a) <= Date.parse(b) ? a : b;
const latest = (a, b) => Date.parse(a) >= Date.parse(b) ? a : b;
const unique = values => [...new Set(values)];

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireExactFields(value, fields, label) {
  if (!sameFields(value, fields)) throw new Error(`${label} has unsupported or missing fields.`);
}

function portableDate(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  try { return isoDate(value); }
  catch { throw new Error(`${label} must be an ISO timestamp.`); }
}

function portablePaper(paper) {
  return {
    arxivId: paper.arxivId,
    title: paper.title,
    authors: paper.authors.map(author => author.displayName),
    savedAt: paper.savedAt,
    updatedAt: paper.updatedAt,
    tags: [...(paper.tags ?? [])],
    note: paper.note ?? "",
    read: paper.read ?? false,
    categories: [...(paper.categories ?? [])],
    abstract: paper.abstract ?? "",
    publishedAt: paper.publishedAt ?? null,
  };
}

const portableCollection = collection => ({ id: collection.id, name: collection.name,
  createdAt: collection.createdAt, updatedAt: collection.updatedAt });
const portablePaperMembership = item => ({ arxivId: item.arxivId, collectionId: item.collectionId,
  addedAt: item.addedAt, updatedAt: item.updatedAt });
const portableAuthorMembership = item => ({ authorId: item.authorId, collectionId: item.collectionId,
  addedAt: item.addedAt, updatedAt: item.updatedAt });

/** Project the selected collection or all records; never project preferences. */
export function exportPortableCategory(state, exportedAt, category, selection = { kind: "all" }) {
  if (!PORTABLE_CATEGORIES.includes(category)) throw new Error("Unknown portable category.");
  requireSelection(selection);
  const bookmarks = category === "bookmarks";
  const collections = bookmarks ? state.paperCollections : state.collections;
  const memberships = bookmarks ? state.paperMemberships : state.memberships;
  const identity = bookmarks ? "arxivId" : "authorId";
  if (selection.kind === "collection" && !collections.some(item => item.id === selection.collectionId)) {
    throw new Error("The selected collection no longer exists. Refresh and try again.");
  }
  const chosenCollections = selection.kind === "all" ? collections
    : collections.filter(item => item.id === selection.collectionId);
  const chosenMemberships = selection.kind === "all" ? memberships
    : memberships.filter(item => item.collectionId === selection.collectionId);
  const ids = new Set(chosenMemberships.map(item => item[identity]));
  const result = { format: PORTABLE_FORMAT, version: SCOPED_PORTABLE_VERSION,
    category, selection: structuredClone(selection), exportedAt: isoDate(exportedAt) };
  if (bookmarks) {
    result.papers = state.favorites.filter(item => ids.has(item.arxivId)).map(portablePaper);
    result.paperCollections = chosenCollections.map(portableCollection);
    result.paperMemberships = chosenMemberships.map(portablePaperMembership);
  } else {
    result.authors = state.authors.filter(item => ids.has(item.id)).map(item => ({
      id: item.id, displayName: item.displayName, normalizedName: item.normalizedName,
      followedAt: item.followedAt, updatedAt: item.updatedAt,
    }));
    result.authorCollections = chosenCollections.map(portableCollection);
    result.authorMemberships = chosenMemberships.map(portableAuthorMembership);
  }
  return result;
}

function requireSelection(selection) {
  if (!isObject(selection) || !["all", "collection"].includes(selection.kind)) {
    throw new Error("Unsupported export selection.");
  }
  requireExactFields(selection, selection.kind === "all" ? ["kind"] : ["kind", "collectionId"], "Export selection");
  if (selection.kind === "collection" && (typeof selection.collectionId !== "string" || !selection.collectionId)) {
    throw new Error("Export selection needs a collection ID.");
  }
}

export function parsePortableCategory(text, category) {
  if (!PORTABLE_CATEGORIES.includes(category)) throw new Error("Unknown portable category.");
  if (typeof text !== "string") throw new Error("The selected backup is not a text file.");
  if (text.length > MAX_IMPORT_LENGTH) throw new Error("The selected backup is too large to import.");
  let input;
  try { input = JSON.parse(text); }
  catch { throw new Error("The selected file is not valid JSON."); }
  if (!isObject(input) || input.format !== PORTABLE_FORMAT) throw new Error("The selected file is not a Xivary library backup.");
  if (input.version === PORTABLE_VERSION) {
    const legacy = validatePortableLibrary(input);
    return { category, selection: { kind: "all" },
      ...Object.fromEntries(CATEGORY_FIELDS[category].map(field => [field, legacy[field]])) };
  }
  if (input.version !== SCOPED_PORTABLE_VERSION) {
    throw new Error(Number.isSafeInteger(input.version) && input.version > SCOPED_PORTABLE_VERSION
      ? `This backup uses newer format version ${input.version}. Update Xivary before importing it.`
      : "This Xivary backup version is not supported.");
  }
  if (input.category !== category) throw new Error(`This is not a ${category} backup.`);
  const oldScoped = !Object.hasOwn(input, "selection");
  requireExactFields(input, ["format", "version", "category", ...(oldScoped ? [] : ["selection"]),
    "exportedAt", ...CATEGORY_FIELDS[category]], "The backup");
  const selection = oldScoped ? { kind: "all" } : input.selection;
  requireSelection(selection);
  portableDate(input.exportedAt, "Export date");
  // Reuse the strict v1 record validator with empty, valid sections outside the
  // selected scope. Those sections never enter the scoped proposal.
  const complete = { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, exportedAt: input.exportedAt,
    papers: [], paperCollections: [], paperMemberships: [], authors: [],
    authorCollections: [], authorMemberships: [],
    preferences: { openArxivLinksInNewTab: false, organizeFollowedAuthorsIntoCollections: false } };
  for (const field of CATEGORY_FIELDS[category]) complete[field] = input[field];
  const validated = validatePortableLibrary(complete);
  if (selection.kind === "collection") {
    const collections = category === "bookmarks" ? validated.paperCollections : validated.authorCollections;
    const memberships = category === "bookmarks" ? validated.paperMemberships : validated.authorMemberships;
    if (collections.length !== 1 || collections[0].id !== selection.collectionId
        || memberships.some(item => item.collectionId !== selection.collectionId)) {
      throw new Error("Collection export does not match its selection.");
    }
  }
  return { category, selection, ...Object.fromEntries(CATEGORY_FIELDS[category].map(field => [field, validated[field]])) };
}

/** Validate and normalize the complete untrusted document before state is changed. */
export function validatePortableLibrary(input) {
  if (!isObject(input)) throw new Error("The selected file is not a Xivary backup.");
  if (input.format !== PORTABLE_FORMAT) throw new Error("The selected file is not a Xivary library backup.");
  if (input.version !== PORTABLE_VERSION) {
    throw new Error(Number.isSafeInteger(input.version) && input.version > PORTABLE_VERSION
      ? `This backup uses newer format version ${input.version}. Update Xivary before importing it.`
      : "This Xivary backup version is not supported.");
  }
  requireExactFields(input, TOP_LEVEL_FIELDS, "The backup");
  const exportedAt = portableDate(input.exportedAt, "Export date");

  const paperIds = new Set();
  const papers = requireArray(input.papers, "Papers").map((record, index) => {
    requireExactFields(record, PAPER_FIELDS, `Paper ${index + 1}`);
    if (record.publishedAt !== null && typeof record.publishedAt !== "string") {
      throw new Error(`Paper ${index + 1} publication date must be an ISO timestamp or null.`);
    }
    const savedAt = portableDate(record.savedAt, `Paper ${index + 1} save date`);
    const normalized = createPaper(record, savedAt);
    if (normalized.arxivId !== record.arxivId || paperIds.has(normalized.arxivId)) {
      throw new Error(`Paper ${index + 1} has a duplicate or noncanonical ID.`);
    }
    const updatedAt = portableDate(record.updatedAt, `Paper ${index + 1} update date`);
    paperIds.add(normalized.arxivId);
    return { ...normalized, updatedAt };
  });

  const paperCollections = validateCollections(input.paperCollections, "paper", "paper-collection:");
  const paperCollectionIds = new Set(paperCollections.map(item => item.id));
  const paperMemberships = validateMemberships(input.paperMemberships, "paper", PAPER_MEMBERSHIP_FIELDS,
    "arxivId", paperIds, paperCollectionIds);
  for (const id of paperIds) {
    if (!paperMemberships.some(item => item.arxivId === id)) throw new Error(`Saved paper ${id} has no collection membership.`);
  }

  const authorIds = new Set();
  const authors = requireArray(input.authors, "Authors").map((record, index) => {
    requireExactFields(record, AUTHOR_FIELDS, `Author ${index + 1}`);
    const followedAt = portableDate(record.followedAt, `Author ${index + 1} follow date`);
    const normalized = createAuthor(record, followedAt);
    if (record.id !== normalized.id || record.normalizedName !== normalized.normalizedName || authorIds.has(record.id)) {
      throw new Error(`Author ${index + 1} has a duplicate or malformed ID.`);
    }
    authorIds.add(record.id);
    return { ...normalized, updatedAt: portableDate(record.updatedAt, `Author ${index + 1} update date`) };
  });
  const authorCollections = validateCollections(input.authorCollections, "author", "collection:");
  const authorCollectionIds = new Set(authorCollections.map(item => item.id));
  const authorMemberships = validateMemberships(input.authorMemberships, "author", AUTHOR_MEMBERSHIP_FIELDS,
    "authorId", authorIds, authorCollectionIds);
  for (const id of authorIds) {
    if (!authorMemberships.some(item => item.authorId === id)) throw new Error(`Followed author ${id} has no collection membership.`);
  }

  requireExactFields(input.preferences, PREFERENCE_FIELDS, "Preferences");
  for (const field of PREFERENCE_FIELDS) {
    if (typeof input.preferences[field] !== "boolean") throw new Error(`Preference ${field} must be true or false.`);
  }
  return { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, exportedAt, papers, paperCollections,
    paperMemberships, authors, authorCollections, authorMemberships,
    preferences: structuredClone(input.preferences) };
}

function validateCollections(value, label, prefix) {
  const ids = new Set(), names = new Set();
  return requireArray(value, `${label} collections`).map((record, index) => {
    requireExactFields(record, COLLECTION_FIELDS, `${label} collection ${index + 1}`);
    if (typeof record.id !== "string" || !record.id.startsWith(prefix) || record.id.length > 256 || ids.has(record.id)) {
      throw new Error(`${label} collection ${index + 1} has a duplicate or malformed ID.`);
    }
    const name = cleanText(record.name, "Collection name");
    if (name.length > 80 || names.has(name.toLowerCase())) {
      throw new Error(`${label} collection ${index + 1} has a duplicate or invalid name.`);
    }
    ids.add(record.id); names.add(name.toLowerCase());
    return { id: record.id, name,
      createdAt: portableDate(record.createdAt, `${label} collection ${index + 1} creation date`),
      updatedAt: portableDate(record.updatedAt, `${label} collection ${index + 1} update date`) };
  });
}

function validateMemberships(value, label, fields, identity, identities, collectionIds) {
  const pairs = new Set();
  return requireArray(value, `${label} memberships`).map((record, index) => {
    requireExactFields(record, fields, `${label} membership ${index + 1}`);
    const pair = JSON.stringify([record[identity], record.collectionId]);
    if (!identities.has(record[identity]) || !collectionIds.has(record.collectionId) || pairs.has(pair)) {
      throw new Error(`${label} membership ${index + 1} has a dangling or duplicate reference.`);
    }
    pairs.add(pair);
    return { [identity]: record[identity], collectionId: record.collectionId,
      addedAt: portableDate(record.addedAt, `${label} membership ${index + 1} addition date`),
      updatedAt: portableDate(record.updatedAt, `${label} membership ${index + 1} update date`) };
  });
}

/** A selected import can only write fields owned by that category. */
export function mergePortableCategory(state, backup) {
  const next = structuredClone(state);
  if (backup.category === "bookmarks") {
    const pristine = next.favorites.length === 0 && next.paperMemberships.length === 0
      && next.paperCollections.length === 1 && next.paperCollections[0].id === "paper-collection:saved-papers";
    const result = {
      importedScope: backup.selection?.kind === "collection"
        ? backup.paperCollections[0].name : "All bookmarks",
      papersAdded: backup.papers.filter(item => !next.favorites.some(local => local.arxivId === item.arxivId)).length,
      papersMerged: backup.papers.filter(item => next.favorites.some(local => local.arxivId === item.arxivId)).length,
      paperCollectionsAdded: backup.paperCollections.filter(item => !next.paperCollections.some(local => local.id === item.id)).length,
      paperMembershipsAdded: backup.paperMemberships.filter(item => !next.paperMemberships.some(local =>
        local.arxivId === item.arxivId && local.collectionId === item.collectionId)).length,
    };
    next.favorites = mergeBy(next.favorites, backup.papers, item => item.arxivId, mergePaper);
    next.paperCollections = mergeCollections(next.paperCollections, backup.paperCollections,
      pristine ? new Set(["paper-collection:saved-papers"]) : new Set());
    next.paperMemberships = mergeBy(next.paperMemberships, backup.paperMemberships,
      item => JSON.stringify([item.arxivId, item.collectionId]), mergeMembership);
    return { state: next, result };
  }
  if (backup.category === "following") {
    const result = {
      importedScope: backup.selection?.kind === "collection"
        ? backup.authorCollections[0].name : "All following",
      authorsAdded: backup.authors.filter(item => !next.authors.some(local => local.id === item.id)).length,
      authorsMerged: backup.authors.filter(item => next.authors.some(local => local.id === item.id)).length,
      authorCollectionsAdded: backup.authorCollections.filter(item => !next.collections.some(local => local.id === item.id)).length,
      authorMembershipsAdded: backup.authorMemberships.filter(item => !next.memberships.some(local =>
        local.authorId === item.authorId && local.collectionId === item.collectionId)).length,
    };
    next.authors = mergeBy(next.authors, backup.authors, item => item.id, mergeAuthor);
    next.collections = mergeCollections(next.collections, backup.authorCollections);
    next.memberships = mergeBy(next.memberships, backup.authorMemberships,
      item => JSON.stringify([item.authorId, item.collectionId]), mergeMembership);
    return { state: next, result };
  }
  throw new Error("Unknown portable category.");
}

function mergeBy(existing, incoming, identity, merge) {
  const result = structuredClone(existing);
  const indexes = new Map(result.map((item, index) => [identity(item), index]));
  for (const item of incoming) {
    const index = indexes.get(identity(item));
    if (index === undefined) {
      indexes.set(identity(item), result.length);
      result.push(structuredClone(item));
    } else result[index] = merge(result[index], item);
  }
  return result;
}

function mergePaper(local, imported) {
  return {
    ...local,
    savedAt: earliest(local.savedAt, imported.savedAt),
    updatedAt: latest(local.updatedAt, imported.updatedAt),
    tags: unique([...local.tags, ...imported.tags]),
    note: local.note || imported.note,
    read: local.read || imported.read,
    categories: unique([...local.categories, ...imported.categories]),
    abstract: local.abstract || imported.abstract,
    publishedAt: local.publishedAt ?? imported.publishedAt,
  };
}

function mergeAuthor(local, imported) {
  return { ...local, followedAt: earliest(local.followedAt, imported.followedAt),
    updatedAt: latest(local.updatedAt, imported.updatedAt) };
}

function mergeMembership(local, imported) {
  return { ...local, addedAt: earliest(local.addedAt, imported.addedAt),
    updatedAt: latest(local.updatedAt, imported.updatedAt) };
}

function mergeCollections(existing, incoming, replaceIds = new Set()) {
  const merged = mergeBy(existing, incoming, item => item.id, (local, imported) => replaceIds.has(local.id)
    ? structuredClone(imported)
    : { ...local, createdAt: earliest(local.createdAt, imported.createdAt),
      updatedAt: latest(local.updatedAt, imported.updatedAt) });
  const byId = new Map(disambiguateCollectionNames(structuredClone(merged).sort((a, b) => a.id.localeCompare(b.id)))
    .map(item => [item.id, item]));
  return merged.map(item => byId.get(item.id));
}
