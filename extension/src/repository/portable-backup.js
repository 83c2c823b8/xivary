import { createPaper } from '../domain/paper.js';
import { createAuthor, createAuthorReference } from '../domain/author.js';
import { normalizeArxivId, cleanText, isoDate } from '../domain/identifiers.js';
import { reconcilePaperOrdering, orderedRecords } from '../domain/paper-ordering.js';
import { writeBackupZip, readBackupZip, encodeBase64, decodeBase64, MAX_BACKUP_BYTES, MAX_JSON_BYTES, MAX_BACKUP_FILES } from './backup-zip.js';

export const BACKUP_VERSION = 3;
const FORMAT = 'xivary-library', sections = ['bookmarks','following'];
const fields = {
  bookmark: ['arxivId','title','authors','savedAt','updatedAt','tags','note','read','categories','abstract','publishedAt','customTitle','customName','displayName','originalTitle','originalMetadata','userMetadata','metadataEdits'],
  following: ['id','displayName','normalizedName','followedAt','updatedAt','alias','aliases','customName','originalName','identity','searchIdentifiers'],
  collection: ['id','name','createdAt','updatedAt','customName','alias'],
};
const json = value => JSON.stringify(value,null,2)+'\n';
const clone = value => structuredClone(value);
const object = value => value && typeof value==='object' && !Array.isArray(value);
const fail = message => { throw new Error(`Invalid Xivary backup: ${message}`); };
function exact(value, keys) { if (!object(value) || Object.keys(value).length!==keys.length || keys.some(key=>!Object.hasOwn(value,key))) fail('unsupported or missing fields.'); }
function date(value) { if(typeof value!=='string' || !Number.isFinite(Date.parse(value)))fail('invalid timestamp.');return isoDate(value); }
function safeValue(value, depth=0) {
  if(depth>12)fail('metadata nesting is too deep.');
  if(value===null || typeof value==='string' || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)))return;
  if(Array.isArray(value)){for(const item of value)safeValue(item,depth+1);return;}
  if(!object(value))fail('non-JSON metadata.');
  for(const [key,item] of Object.entries(value)){
    if(['__proto__','constructor','prototype'].includes(key) || /token|secret|password|path|cache|runtime/i.test(key))fail('unsafe or nonportable metadata field.');
    safeValue(item,depth+1);
  }
}
function project(record,type) {return Object.fromEntries(fields[type].filter(key=>Object.hasOwn(record,key)).map(key=>[key,clone(record[key])]));}
const identity = item => item.type==='bookmark' ? item.record.arxivId : item.record.id;
const key = item => JSON.stringify([item.type,item.category,identity(item)]);
function recordEnvelope(type,category,record,memberships=[]) {return {format:FORMAT,version:BACKUP_VERSION,type,category,record:project(record,type),memberships:clone(memberships)};}
function validateRecord(item) {
  exact(item,['format','version','type','category','record','memberships']);
  if(item.format!==FORMAT || item.version!==BACKUP_VERSION)fail(`unsupported schema version ${item.version}.`);
  if(!fields[item.type] || !sections.includes(item.category) || (item.type==='bookmark'&&item.category!=='bookmarks') || (item.type==='following'&&item.category!=='following'))fail('invalid record type/category.');
  if(!object(item.record) || Object.keys(item.record).some(field=>!fields[item.type].includes(field)))fail('unsupported record field.');
  safeValue(item.record);
  for (const field of ['customTitle','customName','displayName','originalTitle','alias','originalName']) {
    if (Object.hasOwn(item.record,field) && typeof item.record[field] !== 'string') fail(`invalid ${field}.`);
  }
  if (Object.hasOwn(item.record,'aliases') && (!Array.isArray(item.record.aliases) || item.record.aliases.some(alias=>typeof alias!=='string'))) fail('invalid aliases.');
  for (const field of ['originalMetadata','userMetadata','metadataEdits','identity','searchIdentifiers']) {
    if (Object.hasOwn(item.record,field) && !object(item.record[field])) fail(`invalid ${field}.`);
  }
  const record=clone(item.record);
  if(item.type==='bookmark') {
    const normalized=createPaper(record,date(record.savedAt));record.arxivId=normalized.arxivId;
    date(record.updatedAt);
    if(!Array.isArray(record.authors))fail('invalid authors.');
    record.authors=record.authors.map((author,index)=>{
      if(typeof author==='string')return createAuthorReference({displayName:author,sourceArxivId:record.arxivId,sourceAuthorIndex:index});
      exact(author,['id','displayName','normalizedName','sourceArxivId','sourceAuthorIndex']);
      const expected=createAuthorReference({displayName:author.displayName,sourceArxivId:record.arxivId,sourceAuthorIndex:index});
      if(author.id!==expected.id || author.normalizedName!==expected.normalizedName || normalizeArxivId(author.sourceArxivId)!==record.arxivId || author.sourceAuthorIndex!==index)fail('invalid author provenance.');
      return {...author,sourceArxivId:record.arxivId};
    });
    record.absUrl=normalized.absUrl;record.pdfUrl=normalized.pdfUrl;
  } else if(item.type==='following') {
    const normalized=createAuthor(record,date(record.followedAt));date(record.updatedAt);
    if(record.id!==normalized.id || record.normalizedName!==normalized.normalizedName)fail('invalid Following identity.');
  } else {
    const prefix=item.category==='bookmarks'?'paper-collection:':'collection:';
    if(typeof record.id!=='string' || !record.id.startsWith(prefix) || record.id.length>256 || cleanText(record.name,'Collection name')!==record.name || record.name.length>80)fail('invalid collection.');
    date(record.createdAt);date(record.updatedAt);
  }
  if(!Array.isArray(item.memberships) || (item.type!=='collection' && item.memberships.length))fail('invalid memberships.');
  const memberships=item.memberships.map(member=>{
    const idField=item.category==='bookmarks'?'arxivId':'authorId';exact(member,[idField,'collectionId','addedAt','updatedAt']);
    if(member.collectionId!==record.id || typeof member[idField]!=='string')fail('invalid membership reference.');
    date(member.addedAt);date(member.updatedAt);
    return {...member,[idField]:idField==='arxivId'?normalizeArxivId(member[idField]):member[idField]};
  });
  if(new Set(memberships.map(member=>JSON.stringify(member))).size!==memberships.length || new Set(memberships.map(member=>member.arxivId??member.authorId)).size!==memberships.length)fail('duplicate membership.');
  return {...item,record,memberships};
}
function checkScope(category,selection) {
  if(!['all',...sections].includes(category))fail('unknown category.');
  if(!object(selection) || !['all','collection','record'].includes(selection.kind))fail('invalid selection.');
  exact(selection,selection.kind==='all'?['kind']:selection.kind==='collection'?['kind','collectionId']:['kind','id']);
  if(category==='all' && selection.kind!=='all')fail('invalid full backup selection.');
}
function completeOrdering(state,records) {
  const papers=records.filter(item=>item.type==='bookmark').map(identity),authors=records.filter(item=>item.type==='following').map(identity);
  const paperCollections=records.filter(item=>item.type==='collection'&&item.category==='bookmarks'),authorCollections=records.filter(item=>item.type==='collection'&&item.category==='following');
  const ordering=reconcilePaperOrdering(state),pc=new Set(paperCollections.map(identity));
  return {bookmarks:papers,following:authors,paperCollections:ordering.collectionIds.filter(id=>pc.has(id)),authorCollections:authorCollections.map(identity),
    papersByCollection:paperCollections.map(item=>({collectionId:identity(item),paperIds:(ordering.paperOrders.find(order=>order.collectionId===identity(item))?.paperIds || state.favorites.map(paper=>paper.arxivId)).filter(id=>item.memberships.some(member=>member.arxivId===id))})),
    manualPaperCollections:ordering.paperOrders.map(order=>order.collectionId).filter(id=>pc.has(id))};
}
function selectRecords(state,category,selection) {
  const records=[];
  for(const scope of category==='all'?sections:[category]) {
    const paper=scope==='bookmarks', entities=paper?state.favorites:state.authors, collections=paper?state.paperCollections:state.collections, memberships=paper?state.paperMemberships:state.memberships;
    const idField=paper?'arxivId':'authorId',recordType=paper?'bookmark':'following',entityId=paper?'arxivId':'id';
    let chosen=selection.kind==='all'?memberships:selection.kind==='collection'?memberships.filter(item=>item.collectionId===selection.collectionId):memberships.filter(item=>item[idField]===selection.id);
    if(selection.kind==='collection'&&!collections.some(item=>item.id===selection.collectionId))fail('selected collection no longer exists.');
    const ids=new Set(chosen.map(item=>item[idField]));
    if(selection.kind==='record'&&!ids.size)fail('selected record is not saved/followed.');
    const collectionIds=new Set(chosen.map(item=>item.collectionId));
    for(const record of entities.filter(item=>ids.has(item[entityId]))) records.push(recordEnvelope(recordType,scope,record));
    for(const record of collections.filter(item=>selection.kind==='all' || (selection.kind==='collection'?item.id===selection.collectionId:collectionIds.has(item.id)))) {
      records.push(recordEnvelope('collection',scope,record,chosen.filter(item=>item.collectionId===record.id)));
    }
  }
  return records;
}
async function pathFor(item) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key(item)));
  const name=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return `xivary-backup/${item.type==='collection'?'collections':item.category}/${name}.json`;
}
export async function exportBackup(state,category,selection,now) {
  checkScope(category,selection);
  const records=selectRecords(state,category,selection).map(validateRecord),ordering=completeOrdering(state,records);
  const included=category==='all'?sections:[category],exportedAt=date(now);
  const counts={bookmarks:records.filter(item=>item.type==='bookmark').length,following:records.filter(item=>item.type==='following').length,collections:records.filter(item=>item.type==='collection').length};
  if(records.length>MAX_BACKUP_FILES-2)fail('too many records.');
  if(selection.kind!=='all') {
    const document={format:FORMAT,version:BACKUP_VERSION,exportedAt,sections:included,selection,records:records.map(item=>({...item,record:project(item.record,item.type)})),ordering};
    validateDocument(document);
    const text=json(document);if(new TextEncoder().encode(text).length>MAX_JSON_BYTES)fail('individual export exceeds 1 MiB; use a section ZIP.');
    return {filename:`xivary-${category}-${selection.kind}-${exportedAt.slice(0,10)}.json`,mimeType:'application/json',text};
  }
  const files=[];
  for(const item of records)files.push({path:await pathFor(item),text:json({...item,record:project(item.record,item.type)})});
  const manifest={format:FORMAT,version:BACKUP_VERSION,exportedAt,sections:included,selection,counts,files:files.map((file,index)=>({path:file.path,type:records[index].type,category:records[index].category,id:identity(records[index])}))};
  files.unshift({path:'xivary-backup/manifest.json',text:json(manifest)},{path:'xivary-backup/ordering.json',text:json(ordering)});
  return {filename:`xivary-${category}-all-${exportedAt.slice(0,10)}.zip`,mimeType:'application/zip',base64:encodeBase64(writeBackupZip(files))};
}
function ids(value,expected,label) {
  if(!Array.isArray(value) || value.some(id=>typeof id!=='string') || new Set(value).size!==value.length || value.length!==expected.length || expected.some(id=>!value.includes(id)))fail(`invalid ${label} ordering.`);
}
function validateDocument(doc) {
  exact(doc,['format','version','exportedAt','sections','selection','records','ordering']);
  if(doc.format!==FORMAT || doc.version!==BACKUP_VERSION)fail(`unsupported schema version ${doc.version}.`);
  date(doc.exportedAt);if(!Array.isArray(doc.sections)||!doc.sections.length||new Set(doc.sections).size!==doc.sections.length||doc.sections.some(scope=>!sections.includes(scope)))fail('invalid sections.');
  checkScope(doc.sections.length===2?'all':doc.sections[0],doc.selection);
  if(!Array.isArray(doc.records)||doc.records.length>MAX_BACKUP_FILES-2)fail('record count limit.');
  const records=doc.records.map(validateRecord),seen=new Set();
  for(const item of records){if(seen.has(key(item)) || !doc.sections.includes(item.category))fail('duplicate record or wrong section.');seen.add(key(item));}
  const papers=records.filter(item=>item.type==='bookmark').map(identity),authors=records.filter(item=>item.type==='following').map(identity),pc=records.filter(item=>item.type==='collection'&&item.category==='bookmarks'),ac=records.filter(item=>item.type==='collection'&&item.category==='following');
  for(const collection of [...pc,...ac]) for(const member of collection.memberships) if(!(collection.category==='bookmarks'?papers:authors).includes(member.arxivId??member.authorId))fail('missing referenced bookmark or Following entry. Import the complete collection file.');
  for(const id of [...papers,...authors])if(![...pc,...ac].some(item=>item.memberships.some(member=>(member.arxivId??member.authorId)===id)))fail('record has no collection membership.');
  if (doc.selection.kind==='collection') {
    const chosen=[...pc,...ac];
    if(chosen.length!==1 || identity(chosen[0])!==doc.selection.collectionId)fail('collection does not match selection.');
  }
  if (doc.selection.kind==='record') {
    const chosen=records.filter(item=>item.type!=='collection');
    const selected=doc.sections[0]==='bookmarks'?normalizeArxivId(doc.selection.id):doc.selection.id;
    if(chosen.length!==1 || identity(chosen[0])!==selected)fail('record does not match selection.');
  }
  const order=doc.ordering;exact(order,['bookmarks','following','paperCollections','authorCollections','papersByCollection','manualPaperCollections']);
  ids(order.bookmarks,papers,'bookmark');ids(order.following,authors,'Following');ids(order.paperCollections,pc.map(identity),'collection');ids(order.authorCollections,ac.map(identity),'author collection');
  if(!Array.isArray(order.papersByCollection))fail('invalid per-collection ordering.');ids(order.papersByCollection.map(item=>item.collectionId),pc.map(identity),'paper collection');
  for(const item of order.papersByCollection){exact(item,['collectionId','paperIds']);ids(item.paperIds,pc.find(c=>identity(c)===item.collectionId).memberships.map(m=>m.arxivId),'paper');}
  if(!Array.isArray(order.manualPaperCollections)||new Set(order.manualPaperCollections).size!==order.manualPaperCollections.length||order.manualPaperCollections.some(id=>!order.paperCollections.includes(id)))fail('invalid manual order selection.');
  return {...doc,records};
}
function parse(text) {if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_JSON_BYTES)fail('JSON exceeds 1 MiB.');try{return JSON.parse(text);}catch{fail('not valid JSON.');}}
export async function parseBackupFiles(inputs,category='all') {
  if(!['all',...sections].includes(category)||!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_BACKUP_FILES-2)fail('invalid file selection.');
  const docs=[];let bytes=0,expandedTotal=0;
  for(const input of inputs) {
    exact(input,['kind','data']);
    if(input.kind==='zip') {
      const data=decodeBase64(input.data);bytes+=data.length;if(bytes>MAX_BACKUP_BYTES)fail('combined size exceeds 20 MiB.');
      const files=await readBackupZip(data),map=new Map(files.map(file=>[file.path,file.text]));
      expandedTotal+=files.reduce((size,file)=>size+new TextEncoder().encode(file.text).length,0);
      if(expandedTotal>MAX_BACKUP_BYTES)fail('combined expanded size exceeds 20 MiB.');
      const manifest=parse(map.get('xivary-backup/manifest.json'));exact(manifest,['format','version','exportedAt','sections','selection','counts','files']);
      if(manifest.format!==FORMAT||manifest.version!==BACKUP_VERSION)fail(`unsupported schema version ${manifest.version}.`);
      if(!Array.isArray(manifest.files)||files.length!==manifest.files.length+2)fail('manifest file count mismatch.');
      const records=[];const paths=new Set();
      for(const entry of manifest.files) {
        exact(entry,['path','type','category','id']);if(paths.has(entry.path))fail('duplicate manifest path.');paths.add(entry.path);
        const record=validateRecord(parse(map.get(entry.path)));
        if(await pathFor(record)!==entry.path||record.type!==entry.type||record.category!==entry.category||identity(record)!==entry.id)fail('manifest identity/path mismatch.');records.push(record);
      }
      exact(manifest.counts,['bookmarks','following','collections']);
      for(const [name,type] of [['bookmarks','bookmark'],['following','following'],['collections','collection']])if(manifest.counts[name]!==records.filter(item=>item.type===type).length)fail('manifest record count mismatch.');
      // Project derived links out before the same strict JSON document validator.
      docs.push(validateDocument({format:manifest.format,version:manifest.version,exportedAt:manifest.exportedAt,sections:manifest.sections,selection:manifest.selection,records:records.map(item=>({...item,record:project(item.record,item.type)})),ordering:parse(map.get('xivary-backup/ordering.json'))}));
    } else if(input.kind==='json') {
      const size=new TextEncoder().encode(input.data).length;bytes+=size;expandedTotal+=size;
      if(bytes>MAX_BACKUP_BYTES || expandedTotal>MAX_BACKUP_BYTES)fail('combined size exceeds 20 MiB.');docs.push(validateDocument(parse(input.data)));
    } else fail('unsupported file type.');
  }
  const records=new Map(),order={bookmarks:[],following:[],paperCollections:[],authorCollections:[],papersByCollection:[],manualPaperCollections:[]};let duplicates=0;
  const append=(a,b)=>[...new Set([...a,...b])];
  for(const doc of docs) {
    for(const item of doc.records.filter(item=>category==='all'||item.category===category)) {
      const old=records.get(key(item));
      if(old){if(JSON.stringify(old.record)!==JSON.stringify(item.record))fail('conflicting duplicate records in selected files.');
        for(const member of item.memberships){const prior=old.memberships.find(m=>(m.arxivId??m.authorId)===(member.arxivId??member.authorId));if(prior&&JSON.stringify(prior)!==JSON.stringify(member))fail('conflicting duplicate memberships in selected files.');}
        old.memberships=Array.from(new Map([...old.memberships,...item.memberships].map(m=>[m.arxivId??m.authorId,m])).values());duplicates++;}
      else records.set(key(item),clone(item));
    }
    for(const field of ['bookmarks','following','paperCollections','authorCollections','manualPaperCollections'])order[field]=append(order[field],doc.ordering[field]);
    for(const item of doc.ordering.papersByCollection){const previous=order.papersByCollection.find(o=>o.collectionId===item.collectionId);if(previous)previous.paperIds=append(previous.paperIds,item.paperIds);else order.papersByCollection.push(clone(item));}
  }
  if(records.size>MAX_BACKUP_FILES-2)fail('combined record count limit.');
  if(!records.size && !docs.some(doc=>category==='all'||doc.sections.includes(category)))fail('selected backup has no matching section.');
  return {records:[...records.values()],ordering:order,duplicates,sections:category==='all'?[...new Set(docs.flatMap(doc=>doc.sections))]:[category]};
}
export function mergeBackup(state,backup) {
  const next=clone(state),result={imported:0,merged:0,skipped:backup.duplicates,invalid:0,conflicts:0};
  const order=backup.ordering,records=backup.records;
  const pristinePapers=!state.favorites.length&&!state.paperMemberships.length&&state.paperOrdering.paperOrders.length===0&&state.paperOrdering.collectionIds.length===1&&state.paperOrdering.collectionIds[0]==='paper-collection:saved-papers'&&state.paperCollections.length===1
    &&state.paperCollections[0].id==='paper-collection:saved-papers'&&state.paperCollections[0].name==='Saved Papers'
    &&state.paperCollections[0].createdAt===state.paperCollections[0].updatedAt
    &&Object.keys(state.paperCollections[0]).every(field=>['id','name','createdAt','updatedAt'].includes(field));
  const pristineAuthors=!state.memberships.length&&!state.authors.length&&!state.collections.length;
  if(pristinePapers && backup.sections.includes('bookmarks') && records.some(item=>item.type==='collection'&&item.category==='bookmarks'))next.paperCollections=[];
  function mergeRecord(local,incoming,type) {
    const merged=clone(local);
    for(const [field,value] of Object.entries(incoming)){
      if(!Object.hasOwn(local,field)||local[field]===null||local[field]==='')merged[field]=clone(value);
      else if(JSON.stringify(local[field])!==JSON.stringify(value)) {
        if(type==='bookmark'&&field==='title'&&!local.customTitle&&!local.customName&&!local.displayName
            &&(local.title===local.originalTitle || local.title===incoming.originalTitle)
            &&((incoming.customTitle && incoming.customTitle===incoming.title)||(incoming.originalTitle && incoming.title!==incoming.originalTitle)))merged.title=incoming.title;
        else if(type==='bookmark'&&field==='tags')merged.tags=[...new Set([...local.tags,...value])];
        else result.conflicts++;
      }
    }
    return merged;
  }
  const targets={bookmark:'favorites',following:'authors'};
  for(const type of ['bookmark','following','collection'])for(const item of records.filter(item=>item.type===type)){
    const target=type==='collection'?(item.category==='bookmarks'?'paperCollections':'collections'):targets[type],idField=type==='bookmark'?'arxivId':'id';
    const old=next[target].find(record=>record[idField]===identity(item));let unchanged=false;
    if(old){const merged=mergeRecord(old,item.record,type);if(JSON.stringify(merged)===JSON.stringify(old)){result.skipped++;unchanged=true;}else {Object.assign(old,merged);result.merged++;}}
    else {
      const record=clone(item.record);
      if(type==='collection'){
        const original=record.name;let suffix=2;
        while(next[target].some(local=>local.name.toLowerCase()===record.name.toLowerCase()))record.name=`${original.slice(0,72)} (${suffix++})`;
        if(record.name!==original)result.conflicts++;
      }
      next[target].push(record);result.imported++;
    }
    if(type==='collection'){
      const field=item.category==='bookmarks'?'paperMemberships':'memberships',idField=item.category==='bookmarks'?'arxivId':'authorId';
      let added=false;
      for(const member of item.memberships)if(!next[field].some(local=>local.collectionId===member.collectionId&&local[idField]===member[idField])){next[field].push(clone(member));added=true;}
      if(old&&unchanged&&added){result.skipped--;result.merged++;}
    }
  }
  const append=(existing,incoming)=>[...new Set([...existing,...incoming])];
  if(backup.sections.includes('bookmarks')){
    const existing=pristinePapers?{collectionIds:[],paperOrders:[]}:reconcilePaperOrdering(state);
    next.favorites=orderedRecords(next.favorites,append(pristinePapers?[]:state.favorites.map(p=>p.arxivId),order.bookmarks));
    next.paperCollections=orderedRecords(next.paperCollections,append(pristinePapers?[]:state.paperCollections.map(c=>c.id),order.paperCollections));
    const paperOrders=clone(existing.paperOrders);
    for(const id of order.manualPaperCollections){const incoming=order.papersByCollection.find(item=>item.collectionId===id),old=paperOrders.find(item=>item.collectionId===id);if(old)old.paperIds=append(old.paperIds,incoming.paperIds);else {
      const base=pristinePapers?[]:state.favorites.filter(p=>state.paperMemberships.some(m=>m.arxivId===p.arxivId&&m.collectionId===id)).map(p=>p.arxivId);
      paperOrders.push({collectionId:id,paperIds:append(base,incoming.paperIds)});
    }}
    next.paperOrdering={version:1,collectionIds:append(existing.collectionIds,order.paperCollections),paperOrders};
    if(!next.paperCollections.some(c=>c.id===next.settings.lastUsedPaperCollectionId))next.settings.lastUsedPaperCollectionId=null;
  }
  if(backup.sections.includes('following')){
    next.authors=orderedRecords(next.authors,append(pristineAuthors?[]:state.authors.map(a=>a.id),order.following));
    next.collections=orderedRecords(next.collections,append(pristineAuthors?[]:state.collections.map(c=>c.id),order.authorCollections));
  }
  return {state:next,result};
}
