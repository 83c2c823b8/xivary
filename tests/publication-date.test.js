import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPublicationDates } from '../extension/src/domain/publication-date.js';
import { filterAuthorPapers } from '../extension/src/author/filter-papers.js';

test('shared publication filters retain undated/malformed records only when unbounded and never use savedAt',()=>{
 const papers=[{publishedAt:new Date(2020,11,31,12).toISOString(),savedAt:'2026-10-08T00:00:00Z'},{publishedAt:null},{publishedAt:'malformed'},{publishedAt:'2026-10-01T00:00:00Z'}];
 const now=new Date('2026-10-09T12:00:00Z');
 assert.deepEqual(filterPublicationDates(papers),papers);
 assert.deepEqual(filterPublicationDates(papers,{range:'year'},now),[papers[3]]);
 assert.deepEqual(filterPublicationDates(papers,{range:'custom',from:'2020',to:'2020'}),[papers[0]]);
 for(const range of ['any','year','three-years']) assert.deepEqual(filterPublicationDates(papers,{range},now),filterAuthorPapers(papers,{range},now));
});
test('shared date filtering preserves order and composes with an existing selected-paper subset',()=>{
 const papers=[2024,2026,2020].map((year,i)=>({arxivId:String(i),title:'Saved research',publishedAt:new Date(year,0,1).toISOString()}));
 assert.deepEqual(filterPublicationDates(papers,{range:'custom',from:'2020',to:'2024'}),[papers[0],papers[2]]);
 const selected=papers.filter(paper=>new Set(['0','1']).has(paper.arxivId));
 assert.deepEqual(filterPublicationDates(selected,{range:'custom',from:'2024',to:'2024'}),[papers[0]]);
});
