import { normalizeAuthorName, stableAuthorKey } from '../domain/author.js';
import { normalizeApiEntry } from '../services/arxiv-paper-service.js';

export const DAY = 86400000;
export const RECENT_DAYS = 30;
export const EVIDENCE_TTL = 7 * DAY;
export const EVIDENCE_DAYS = 3 * 365;
export const MAX_EVIDENCE_PAPERS = 200;
export const MAX_COAUTHORS = 20;
export const MAX_RELATED_PAPERS = 5;

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const followedIds = authors => [...new Set(authors.map(author => author.id))].sort(compare);

/** Exactly 30 * 24 hours, inclusive, independent of local calendar/timezone. */
export function recentWindow(now = Date.now()) {
  const end = new Date(now).getTime();
  if (!Number.isFinite(end)) throw new Error('Invalid Feed timestamp.');
  return { start: new Date(end - RECENT_DAYS * DAY).toISOString(), end: new Date(end).toISOString() };
}

export function eligiblePaper(paper, window) {
  const time = Date.parse(paper.publishedAt);
  return Number.isFinite(time) && time >= Date.parse(window.start) && time <= Date.parse(window.end);
}

// API date ranges are UTC and minute-granular. Round outward; local eligibility
// enforces exact milliseconds so cutoff papers are neither lost nor over-admitted.
export function dateQuery(window) {
  const format = time => new Date(time).toISOString().slice(0, 16).replace(/[-T:]/gu, '');
  return `submittedDate:[${format(Math.floor(Date.parse(window.start) / 60000) * 60000)} TO ${format(Math.ceil(Date.parse(window.end) / 60000) * 60000)}]`;
}

export function currentCacheWindow(cache, now = Date.now()) {
  const current = recentWindow(now);
  return { start: current.start, end: new Date(Math.min(Date.parse(current.end), Date.parse(cache.window.end))).toISOString() };
}

const stopWords = new Set(`about above after again algebra algebraic analysis applications approach based between categories category class classes construction corresponding defined different equations every example family first framework general geometry group groups higher however important including introduction large latest manifold manifolds mathematical methods model models natural paper problem problems properties prove provided related research result results scientific second shown shows simple spaces structure structures study system systems their theorem theory these those through using various version which while within without would`.split(' '));
for (const word of 'already among assume being called cannot certain clearly consider denotes denote either establish follows given hence holds known necessary obtain obtained often other particular proved provides several sufficient therefore there under where whose'.split(' ')) stopWords.add(word);
function words(text) { return String(text).replace(/\\[a-z]+/giu, ' ').normalize('NFKC').toLowerCase().match(/\p{L}[\p{L}'-]*/gu) || []; }
const specific = word => word.length >= 5 && word.length <= 80 && !stopWords.has(word);
export function terminology(paper) {
  return [...new Set(words(`${paper.title} ${paper.abstract || ''}`).filter(specific))].sort(compare).slice(0, 160);
}
function phrases(text) {
  const tokens = words(text), result = new Set();
  for (let index = 1; index < tokens.length; index++) if (specific(tokens[index - 1]) && specific(tokens[index])) result.add(`${tokens[index - 1]} ${tokens[index]}`);
  return [...result].sort(compare);
}
function overlap(a, b) { const values = new Set(b); return a.filter(item => values.has(item)); }

export function fullDiscoveryName(name) {
  const tokens = normalizeAuthorName(name).split(' ');
  return name.length <= 160 && tokens.length >= 2 && tokens.length <= 6 && tokens.every(token => /^\p{L}[\p{L}'-]+$/u.test(token))
    && !tokens.some(token => ['collaboration', 'consortium', 'team'].includes(token));
}
export function ambiguousDiscoveryName(name) {
  return !fullDiscoveryName(name) || normalizeAuthorName(name).split(' ').at(-1).replace(/['-]/gu, '').length <= 3;
}

/** Only papers containing explicitly followed names establish an edge. Neither
 * discovered authors' papers nor category candidates are ever graph seeds. */
export function discoverCoauthors(papers, authors, now = Date.now()) {
  const cutoff = new Date(now).getTime() - EVIDENCE_DAYS * DAY;
  const following = new Map(authors.map(author => [normalizeAuthorName(author.displayName), author]));
  const relations = new Map(), seen = new Set();
  for (const source of papers.slice(0, MAX_EVIDENCE_PAPERS)) {
    const paper = normalizeApiEntry(source), submitted = Date.parse(paper.publishedAt);
    if (seen.has(paper.arxivId) || submitted < cutoff || submitted > new Date(now).getTime() || paper.authors.length > 12) continue;
    seen.add(paper.arxivId);
    const matched = paper.authors.map(name => following.get(normalizeAuthorName(name))).filter(Boolean);
    if (!matched.length) continue;
    for (const name of paper.authors) {
      if (following.has(normalizeAuthorName(name)) || !fullDiscoveryName(name)) continue;
      const id = stableAuthorKey(name);
      const relation = relations.get(id) || { id, displayName: name, evidence: [] };
      relation.evidence.push({ arxivId: paper.arxivId, publishedAt: paper.publishedAt, followedIds: followedIds(matched), categories: paper.categories, terms: terminology(paper) });
      relations.set(id, relation);
    }
  }
  const timestamp = new Date(now).getTime();
  const candidates = [...relations.values()].map(relation => {
    relation.evidence.sort((a, b) => compare(b.publishedAt, a.publishedAt) || compare(a.arxivId, b.arxivId));
    const totalEvidence = relation.evidence.length;
    return { ...relation, evidence: relation.evidence.slice(0, 8), totalEvidence, latestAt: relation.evidence[0].publishedAt };
  }).filter(relation => relation.totalEvidence >= 2 || (!ambiguousDiscoveryName(relation.displayName) && timestamp - Date.parse(relation.latestAt) <= 90 * DAY));
  const bucket = relation => timestamp - Date.parse(relation.latestAt) <= 90 * DAY ? 2 : timestamp - Date.parse(relation.latestAt) <= 365 * DAY ? 1 : 0;
  candidates.sort((a, b) => bucket(b) - bucket(a) || b.totalEvidence - a.totalEvidence || compare(b.latestAt, a.latestAt) || compare(a.id, b.id));
  const counts = new Map(), selected = [];
  for (const relation of candidates) {
    const ids = [...new Set(relation.evidence.flatMap(item => item.followedIds))];
    if (!ids.every(id => (counts.get(id) || 0) < 4)) continue;
    selected.push(relation); for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    if (selected.length === MAX_COAUTHORS) break;
  }
  return { relationships: selected, truncated: selected.length < candidates.length };
}

/** Broad categories supply no eligibility by themselves. Require several
 * specific overlapping words and an actual adjacent title phrase as evidence. */
export function researchAreas(papers, authors, window) {
  const names = new Set(authors.map(author => normalizeAuthorName(author.displayName)));
  const categories = new Map();
  for (const paper of papers) {
    if (!eligiblePaper(paper, window) || !paper.authors.some(name => names.has(normalizeAuthorName(name)))) continue;
    const terms = terminology(paper), titlePhrases = phrases(paper.title);
    if (terms.length < 3 || !titlePhrases.length) continue;
    for (const category of paper.categories.filter(value => /^[a-z]+(?:-[a-z]+)?(?:\.[A-Z]{2})?$/u.test(value))) {
      const area = categories.get(category) || { category, papers: [], followed: new Set(), terms: new Map(), phrases: new Map() };
      area.papers.push(paper.arxivId);
      for (const author of authors) if (paper.authors.some(name => normalizeAuthorName(name) === normalizeAuthorName(author.displayName))) area.followed.add(author.id);
      for (const term of terms) area.terms.set(term, (area.terms.get(term) || 0) + 1);
      for (const phrase of titlePhrases) area.phrases.set(phrase, (area.phrases.get(phrase) || 0) + 1);
      categories.set(category, area);
    }
  }
  const strongest = map => [...map].sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).map(item => item[0]);
  return [...categories.values()].sort((a, b) => b.papers.length - a.papers.length || compare(a.category, b.category)).slice(0, 2)
    .map(area => ({ category: area.category, terms: strongest(area.terms).slice(0, 30), phrases: strongest(area.phrases).slice(0, 3), evidenceIds: [...new Set(area.papers)].sort(compare), followedIds: [...area.followed].sort(compare) }));
}

export function recommendation(paper, authors, relationships = [], areas = [], index = null) {
  const names = new Set(paper.authors.map(normalizeAuthorName));
  const byName = index?.byName || new Map(authors.map(author => [normalizeAuthorName(author.displayName), author]));
  const byId = index?.byId || new Map(authors.map(author => [author.id, author]));
  const following = [...names].map(name => byName.get(name)).filter(Boolean).sort((a, b) => compare(a.id, b.id));
  if (following.length) return { source: 'following', strength: following.length, topical: 0,
    label: `Following: ${following[0].displayName}${following.length > 1 ? ` +${following.length - 1}` : ''}`,
    detail: `Name matches: ${following.map(author => author.displayName).join(', ')}. Namesakes may share results.`, provenance: { followedIds: followedIds(following), evidence: [] } };
  const terms = terminology(paper);
  const coauthors = relationships.filter(relation => names.has(normalizeAuthorName(relation.displayName))).map(relation => {
    const evidence = relation.evidence.filter(item => overlap(paper.categories, item.categories).length && overlap(terms, item.terms).length >= 2);
    return { relation, evidence, topical: Math.max(0, ...evidence.map(item => overlap(terms, item.terms).length)) };
  }).filter(item => item.evidence.length);
  coauthors.sort((a, b) => b.relation.totalEvidence - a.relation.totalEvidence || b.topical - a.topical || compare(a.relation.id, b.relation.id));
  if (coauthors.length) {
    const { relation, evidence, topical } = coauthors[0];
    const ids = new Set(evidence.flatMap(item => item.followedIds));
    const followed = [...ids].map(id => byId.get(id)).filter(Boolean).sort((a, b) => compare(a.id, b.id));
    if (followed.length) return { source: 'coauthor', strength: relation.totalEvidence, topical, label: `Coauthor of ${followed[0].displayName}`,
      detail: `${relation.displayName}; name-based coauthorship evidence: ${evidence.map(item => item.arxivId).join(', ')}. Shared terminology: ${overlap(terms, evidence.flatMap(item => item.terms)).slice(0, 6).join(', ')}. Namesakes may share results.`,
      provenance: { followedIds: [...ids].sort(compare), actorId: relation.id, evidence: evidence.map(item => ({ arxivId: item.arxivId, publishedAt: item.publishedAt })) } };
  }
  const related = areas.map(area => ({ area, shared: overlap(terms, area.terms), phrase: overlap(phrases(`${paper.title} ${paper.abstract || ''}`), area.phrases) }))
    .filter(item => paper.categories.includes(item.area.category) && item.shared.length >= 3 && item.phrase.length);
  related.sort((a, b) => b.shared.length - a.shared.length || compare(a.area.category, b.area.category));
  if (related.length) return { source: 'related', strength: 0, topical: related[0].shared.length, label: `Related: ${related[0].area.category}`,
    detail: `Shared terminology: ${related[0].shared.slice(0, 6).join(', ')}; evidence papers: ${related[0].area.evidenceIds.join(', ')}.`,
    provenance: { followedIds: related[0].area.followedIds || [], category: related[0].area.category, evidence: related[0].area.evidenceIds.map(arxivId => ({ arxivId })) } };
  return null;
}

export function discoveryPapers(papers, authors, { window = recentWindow(), excludedIds = [], relationships = [], areas = [], relatedLimit = MAX_RELATED_PAPERS } = {}) {
  const excluded = new Set(excludedIds), unique = new Map();
  const index = { byName: new Map(authors.map(author => [normalizeAuthorName(author.displayName), author])), byId: new Map(authors.map(author => [author.id, author])) };
  const version = paper => Number(paper.versionedId?.match(/v(\d+)$/u)?.[1] || 0);
  for (const source of papers) {
    const paper = normalizeApiEntry(source);
    if (!eligiblePaper(paper, window) || excluded.has(paper.arxivId)) continue;
    const reason = recommendation(paper, authors, relationships, areas, index);
    if (!reason) continue;
    const previous = unique.get(paper.arxivId);
    if (!previous || version(paper) > version(previous)) unique.set(paper.arxivId, { ...paper, reason });
  }
  const priority = { following: 3, coauthor: 2, related: 1 };
  const sorted = [...unique.values()].sort((a, b) => compare(b.publishedAt, a.publishedAt) || priority[b.reason.source] - priority[a.reason.source]
    || b.reason.strength - a.reason.strength || b.reason.topical - a.reason.topical || compare(a.arxivId, b.arxivId));
  let related = 0;
  return sorted.filter(paper => paper.reason.source !== 'related' || ++related <= relatedLimit);
}

export function normalizeEvidenceCache(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.followedIds) || typeof input.truncated !== 'boolean'
      || !Number.isFinite(Date.parse(input.fetchedAt)) || !Array.isArray(input.papers) || input.papers.length > MAX_EVIDENCE_PAPERS
      || input.followedIds.some(id => typeof id !== 'string' || !id.startsWith('arxiv-author:name:v1:'))
      || new Set(input.followedIds).size !== input.followedIds.length) throw new Error('Invalid coauthor evidence cache.');
  return { version: 1, followedIds: [...input.followedIds].sort(compare), fetchedAt: new Date(input.fetchedAt).toISOString(),
    truncated: input.truncated, papers: input.papers.map(normalizeApiEntry) };
}

export function evidenceIsFresh(cache, authors, now = Date.now()) {
  return Boolean(cache) && JSON.stringify(cache.followedIds) === JSON.stringify(followedIds(authors))
    && new Date(now).getTime() - Date.parse(cache.fetchedAt) < EVIDENCE_TTL && Date.parse(cache.fetchedAt) <= new Date(now).getTime();
}
