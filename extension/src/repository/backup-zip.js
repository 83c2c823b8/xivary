// Small ZIP transport: stored exports, stored/Deflate imports. No filesystem or
// third-party parser. Layout follows PKWARE APPNOTE; inflation is streamed through
// the platform's bounded DecompressionStream (Chrome 121 / Firefox 140 support it).
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_BACKUP_FILES = 5002;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i & 1) ? (0xedb88320 ^ (i >>> 1)) : i >>> 1;
  return i >>> 0;
});
export function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export function validBackupPath(path) {
  return typeof path === 'string' && /^xivary-backup\/(?:manifest\.json|ordering\.json|(?:bookmarks|following|collections)\/[a-f0-9]{64}\.json)$/u.test(path);
}
const directoryPath = path => /^xivary-backup\/(?:|bookmarks\/|following\/|collections\/)$/u.test(path);
const fail = message => { throw new Error(`Invalid backup ZIP: ${message}`); };
const concat = chunks => { const size = chunks.reduce((n, chunk) => n + chunk.length, 0); const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes; };

export function writeBackupZip(files) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_BACKUP_FILES) fail('too many files.');
  const local = [], central = [], seen = new Set(); let offset = 0;
  for (const file of files) {
    if (!validBackupPath(file.path) || seen.has(file.path)) fail('unsafe or duplicate path.');
    seen.add(file.path);
    const name = encoder.encode(file.path), data = encoder.encode(file.text), crc = crc32(data);
    if (data.length > MAX_JSON_BYTES) fail('a JSON record exceeds 1 MiB.');
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x800,true); h.setUint16(12,33,true);
    h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true);
    const record = new Uint8Array(46), c = new DataView(record.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true); c.setUint16(14,33,true);
    c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true);
    local.push(header,name,data); central.push(record,name); offset += 30 + name.length + data.length;
    if (offset > MAX_BACKUP_BYTES) fail('backup exceeds 20 MiB.');
  }
  const directory = concat(central), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,directory.length,true); e.setUint32(16,offset,true);
  if (offset + directory.length + 22 > MAX_BACKUP_BYTES) fail('backup exceeds 20 MiB.');
  return concat([...local,directory,end]);
}
function extras(bytes, start, length) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.length); let offset = start;
  while (offset < start + length) {
    if (offset + 4 > start + length) fail('truncated extra fields.');
    const id = view.getUint16(offset,true), size = view.getUint16(offset+2,true);
    if (![0x5455,0x7875].includes(id) || offset + 4 + size > start + length) fail('unsupported extra fields (ZIP64 and alternate paths are not supported).');
    offset += 4 + size;
  }
}
export async function readBackupZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BACKUP_BYTES || bytes.length < 22) fail('size limit or truncated archive.');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.length), need = (at,size) => { if (at < 0 || at + size > bytes.length) fail('truncated structure.'); };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0,bytes.length - 65557); i--) if (view.getUint32(i,true) === 0x06054b50 && i + 22 + view.getUint16(i+20,true) === bytes.length) { end = i; break; }
  if (end < 0) fail('missing end record.');
  const count = view.getUint16(end+10,true), size = view.getUint32(end+12,true), start = view.getUint32(end+16,true);
  if (view.getUint16(end+4,true) || view.getUint16(end+6,true) || view.getUint16(end+8,true) !== count || !count || count > MAX_BACKUP_FILES + 4 || start + size !== end) fail('split, ZIP64, oversized or inconsistent directory.');
  const entries = [], seen = new Set(); let cursor = start, total = 0;
  for (let index = 0; index < count; index++) {
    need(cursor,46); if (view.getUint32(cursor,true) !== 0x02014b50) fail('invalid directory record.');
    const flags = view.getUint16(cursor+8,true), method = view.getUint16(cursor+10,true), crc = view.getUint32(cursor+16,true), compressed = view.getUint32(cursor+20,true), expanded = view.getUint32(cursor+24,true);
    const nameLength = view.getUint16(cursor+28,true), extraLength = view.getUint16(cursor+30,true), commentLength = view.getUint16(cursor+32,true), offset = view.getUint32(cursor+42,true);
    need(cursor+46,nameLength+extraLength+commentLength);
    const path = decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength)), directory = directoryPath(path);
    if ((!validBackupPath(path) && !directory) || seen.has(path) || flags & ~0x80e || ![0,8].includes(method)
        || view.getUint16(cursor+34,true) || (view.getUint32(cursor+38,true) >>> 16 & 0xf000) === 0xa000 || expanded > MAX_JSON_BYTES
        || compressed > MAX_BACKUP_BYTES || offset >= start || (directory && (compressed || expanded))) fail('unsafe/duplicate path, encryption, compression or size.');
    extras(bytes,cursor+46+nameLength,extraLength); seen.add(path); total += expanded;
    if (total > MAX_BACKUP_BYTES) fail('expanded size exceeds 20 MiB.');
    entries.push({path,flags,method,crc,compressed,expanded,offset,directory}); cursor += 46+nameLength+extraLength+commentLength;
  }
  if (cursor !== end) fail('directory length mismatch.');
  let previous = 0; const files = [];
  for (const entry of entries.sort((a,b)=>a.offset-b.offset)) {
    const {offset,compressed,expanded,flags,method,crc}=entry;
    if (offset !== previous) fail('overlapping, hidden or noncontiguous local records.');
    need(offset,30); const nameLength=view.getUint16(offset+26,true), extraLength=view.getUint16(offset+28,true), dataStart=offset+30+nameLength+extraLength;
    need(offset+30,nameLength+extraLength+compressed);
    if (view.getUint32(offset,true)!==0x04034b50 || view.getUint16(offset+6,true)!==flags || view.getUint16(offset+8,true)!==method
        || decoder.decode(bytes.subarray(offset+30,offset+30+nameLength))!==entry.path || dataStart+compressed>start) fail('local record disagrees with directory.');
    extras(bytes,offset+30+nameLength,extraLength);
    previous=dataStart+compressed;
    if (flags & 8) {
      need(previous,4); const signed=view.getUint32(previous,true)===0x08074b50; const descriptor=previous+(signed?4:0); need(descriptor,12);
      if (view.getUint32(descriptor,true)!==crc || view.getUint32(descriptor+4,true)!==compressed || view.getUint32(descriptor+8,true)!==expanded) fail('invalid data descriptor.');
      previous=descriptor+12;
    } else if (view.getUint32(offset+14,true)!==crc || view.getUint32(offset+18,true)!==compressed || view.getUint32(offset+22,true)!==expanded) fail('local sizes/checksum disagree.');
    if (previous > start) fail('local record exceeds data region.');
    let data=bytes.subarray(dataStart,dataStart+compressed);
    if (method===8) {
      const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks=[]; let produced=0;
      try {
        for (;;) { const {value,done}=await reader.read(); if(done)break; produced+=value.length;
          if(produced>expanded || produced>MAX_JSON_BYTES) fail('inflated data exceeds declared size.'); chunks.push(value); }
        data=concat(chunks);
      } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    }
    if (data.length!==expanded || crc32(data)!==crc) fail('size or CRC mismatch.');
    if (!entry.directory) files.push({path:entry.path,text:decoder.decode(data)});
  }
  if (previous!==start || files.length>MAX_BACKUP_FILES) fail('data length or file count mismatch.');
  return files;
}
export function encodeBase64(bytes) { let text=''; for(let offset=0;offset<bytes.length;offset+=32768)text+=String.fromCharCode(...bytes.subarray(offset,offset+32768)); return btoa(text); }
export function decodeBase64(text) {
  if(typeof text!=='string' || text.length>Math.ceil(MAX_BACKUP_BYTES/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) throw new Error('Invalid or oversized backup file.');
  return Uint8Array.from(atob(text),character=>character.charCodeAt(0));
}
