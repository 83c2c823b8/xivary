import assert from 'node:assert/strict';

/** Real elapsed timers + native pointer movement on installed extension pages. */
export async function undoNotificationWorkflow({ evaluate, until, click, movePointer, screenshot = async () => {} }) {
  const rpc = operation => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${operation};})()`;
  const pause = ms => evaluate(`new Promise(resolve=>setTimeout(()=>resolve(true),${ms}))`);
  await movePointer(5, 5);
  await until("!document.querySelector('.xivary-undo')");
  const original = await evaluate(rpc('repository.getPaperLibrary()'));
  const paper = { arxivId: '2401.00998', title: 'Undo notification fixture', authors: ['Alex Kim'], abstract: 'Retain all metadata.' };
  await evaluate(rpc(`repository.savePaper(${JSON.stringify(paper)})`));
  const collection = await evaluate(rpc(`repository.createPaperCollection('Undo notification fixture',${JSON.stringify(paper)})`));
  const before = await evaluate(rpc('repository.getPaperLibrary()'));
  async function remove() {
    await movePointer(5, 5);
    await evaluate(`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();window.noticeReceipt=await repository.removePaperFromCollection(${JSON.stringify(paper.arxivId)},${JSON.stringify(collection.id)});const {showUndo}=await import('../ui/undo.js');window.noticeStart=performance.now();window.noticeFocus=document.activeElement;showUndo(repository,window.noticeReceipt,'Removed from collection.');showUndo(repository,window.noticeReceipt,'Removed from collection.');})()`);
    assert.equal(await evaluate("document.querySelectorAll('.xivary-undo').length"), 1, 'one receipt produces one notice');
    assert.equal(await evaluate('document.activeElement===window.noticeFocus'), true, 'notice does not steal focus');
    const geometry = await evaluate("(()=>{const toast=document.querySelector('.xivary-undo'),r=toast.getBoundingClientRect();return{right:document.documentElement.clientWidth-r.right,bottom:innerHeight-r.bottom,height:r.height,width:r.width,viewport:innerWidth}})()");
    assert.ok(geometry.right >= 11 && geometry.right <= 13 && geometry.bottom >= 11 && geometry.bottom <= 13, JSON.stringify(geometry));
    assert.ok(geometry.height <= 42 && geometry.width <= Math.min(360, geometry.viewport - 24), JSON.stringify(geometry));
  }
  await remove(); await pause(1000);
  const point = await evaluate("(()=>{const r=document.querySelector('.xivary-undo').getBoundingClientRect();return{x:r.left+8,y:r.top+8}})()");
  await movePointer(point.x, point.y); await pause(2400);
  assert.equal(await evaluate("Boolean(document.querySelector('.xivary-undo'))"), true, 'native hover keeps notice beyond three seconds');
  await screenshot('undo-notification-bottom-right.png');
  await movePointer(5, 5); await pause(900);
  assert.equal(await evaluate("Boolean(document.querySelector('.xivary-undo'))"), true, 'remaining time resumes');
  await until("!document.querySelector('.xivary-undo')");
  const elapsed = await evaluate('performance.now()-window.noticeStart');
  assert.ok(elapsed >= 5300 && elapsed < 6800, elapsed);
  await evaluate(rpc('repository.undoRemoval(window.noticeReceipt.undoToken)'));
  const restored = await evaluate(rpc('repository.getPaperLibrary()'));
  assert.deepEqual(restored.papers, before.papers); assert.deepEqual(restored.memberships, before.memberships);
  await remove();
  await evaluate("document.querySelector('.xivary-undo button').focus()"); await pause(3200);
  assert.equal(await evaluate("document.activeElement===document.querySelector('.xivary-undo button')"), true, 'keyboard focus pauses dismissal');
  await click('.xivary-undo button'); await until("!document.querySelector('.xivary-undo')");
  const clicked = await evaluate(rpc('repository.getPaperLibrary()'));
  assert.deepEqual(clicked.papers, before.papers); assert.deepEqual(clicked.memberships, before.memberships);
  await evaluate(rpc(`repository.removeFavorite(${JSON.stringify(paper.arxivId)})`));
  await evaluate(rpc(`repository.deletePaperCollection(${JSON.stringify(collection.id)})`));
  const final = await evaluate(rpc('repository.getPaperLibrary()'));
  assert.deepEqual(final.papers, original.papers); assert.deepEqual(final.memberships, original.memberships);
  console.log('UNDO NOTICE PASS: native bottom-right compact geometry, three-second visible timer, hover remaining-time pause/resume, focus retention, receipt deduplication and exact metadata/membership restoration');
}
