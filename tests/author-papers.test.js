import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorQuery, buildApiQuery, isAuthorCacheFresh, normalizeCachedAuthorResults } from "../extension/src/services/arxiv-paper-service.js";
import { expandQuery } from "../extension/src/search/expand-query.js";

const paper = { id:"https://arxiv.org/abs/2401.00001v2", title:"  A  paper\n", authors:["Alex Kim"], abstract:" An abstract. ", publishedAt:"2026-09-20T00:00:00Z", categories:["math.AG","math.AG"] };
test("author detail query uses the canonical display name without Chrome dependencies",()=>{assert.equal(buildAuthorQuery({displayName:'A. "Quoted" Name'}),'au:"A. \\"Quoted\\" Name"')});
test("cached author results normalize into portable paper records",()=>{const cache=normalizeCachedAuthorResults({authorId:"author:1",papers:[paper],fetchedAt:"2026-09-24T00:00:00Z",queryUsed:'au:"Alex Kim"'});assert.equal(cache.papers[0].arxivId,"2401.00001");assert.deepEqual(cache.papers[0].categories,["math.AG"]);assert.equal(cache.papers[0].absUrl,"https://arxiv.org/abs/2401.00001")});
test("author cache freshness uses a centralized TTL boundary",()=>{const cache={fetchedAt:"2026-09-24T00:00:00Z"};const now=Date.parse("2026-09-25T00:00:00Z");assert.equal(isAuthorCacheFresh(cache,now,24*60*60*1000),false);assert.equal(isAuthorCacheFresh(cache,now-1,24*60*60*1000),true);assert.equal(isAuthorCacheFresh(null,now),false)});
test("field search plans translate to arXiv API syntax",()=>{const plan=expandQuery({query:"mirror symmetry",fieldId:"mirror-symmetry",mode:"balanced"});const query=buildApiQuery(plan);assert.match(query,/all:\"mirror symmetry\"/);assert.match(query,/cat:math\.AG/);assert.match(query,/ OR /)});
