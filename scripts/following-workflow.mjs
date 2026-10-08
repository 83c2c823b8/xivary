import assert from "node:assert/strict";

// The same observable Following workflow runs in both native browser harnesses.
// RPC is used only to inspect outcomes; every modification uses production UI.
export async function followingWorkflow({ evaluate, click, until, reload, key, screenshot = async () => {} }) {
  const snapshot = () => evaluate("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');return new RepositoryClient().getAuthorLibrary()})()");
  const bookmarks = () => evaluate("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const {exportedAt,...data}=await new RepositoryClient().exportCategory('bookmarks');return data})()");
  const fill = (selector, value) => evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
  const collectionSelector = id => `[data-collection-id=${JSON.stringify(id)}]`;
  const action = async (id, name) => {
    await evaluate(`document.querySelector(${JSON.stringify(collectionSelector(id))}).focus()`);
    await key("Shift+F10");
    await click(`.collection-menu [data-action=${name}]`);
  };
  const checkbox = id => `.arxiv-collection-picker input[type=checkbox][value=${JSON.stringify(id)}]`;
  const settled = () => until("!document.querySelector('#show-create').disabled && !document.querySelector('#status').textContent");
  const original = await snapshot();
  const papers = await bookmarks();
  const memberIds = new Set(original.memberships.map(item => item.authorId));
  assert.equal(memberIds.size, 1, "workflow starts with one default/previously followed author");
  const author = original.authors.find(item => memberIds.has(item.id));
  const previous = original.memberships.filter(item => item.authorId === author.id).map(item => item.collectionId);
  assert.equal(original.settings.organizeFollowedAuthorsIntoCollections, false);
  assert.equal(await evaluate("document.querySelector('#collection-sidebar').hidden && [...document.querySelectorAll('.manage-collections')].every(node=>node.hidden)"), true);

  async function preference(enabled) {
    await click(".settings-link");
    await until("document.querySelector('#organize-author-collections') && !document.querySelector('#organize-author-collections').disabled");
    await click("#organize-author-collections + .toggle");
    await until(`document.querySelector('#organize-author-collections').checked === ${enabled} && !document.querySelector('#organize-author-collections').disabled`);
    await click(".app-nav a[href*=authors]");
    await until(`document.querySelector('#collection-sidebar')?.hidden === ${!enabled} && document.querySelectorAll('.author-row').length === 1`);
  }
  await preference(true);
  await collectionMenuWorkflow({ evaluate, click, key, screenshot });
  assert.equal(await evaluate("document.querySelector('.collection-link .collection-count').textContent"), "1");
  assert.equal(await evaluate("document.documentElement.scrollWidth === document.documentElement.clientWidth"), true);
  assert.equal(await evaluate("document.querySelector('[data-collection-id=\"\"] span').textContent"), "All Following");
  await click("#show-create");
  await key("Escape");
  assert.equal(await evaluate("document.querySelector('#create-form').hidden && document.activeElement.id==='show-create'"), true);

  const collectionCount = (await snapshot()).collections.length;
  await click("#show-create");
  await fill("#collection-name", "typed but cancelled");
  await click("h1");
  assert.equal(await evaluate("document.querySelector('#create-form').hidden"), true);
  await click("#show-create"); await fill("#collection-name", "   "); await key("Enter");
  assert.equal(await evaluate("document.querySelector('#create-form').hidden"), true);
  assert.equal((await snapshot()).collections.length, collectionCount);

  async function create(name) {
    await click("#show-create");
    await fill("#collection-name", name);
    await key("Enter");
    await until(`!document.querySelector('#show-create').disabled && [...document.querySelectorAll('.collection-link span:first-child')].some(node=>node.textContent===${JSON.stringify(name)})`);
    const entry = (await snapshot()).collections.find(item => item.name === name);
    assert.equal(await evaluate("document.querySelector('#empty').textContent"), "No authors in this collection.");
    return entry;
  }
  const first = await create("Workflow A");
  const second = await create("Workflow B");
  // Rename uses the same inline keyboard pattern as Library and retains its ID.
  await action(second.id, "rename");
  await key("Escape");
  assert.equal(await evaluate("document.activeElement.classList.contains('collection-link')"), true);
  await action(second.id, "rename");
  await fill("[data-rename-id]", "Workflow Renamed");
  await key("Enter");
  await until("!document.querySelector('[data-rename-id]') && !document.querySelector('#show-create').disabled");
  assert.equal((await snapshot()).collections.find(item => item.id === second.id).name, "Workflow Renamed");
  assert.equal(await evaluate("document.activeElement.classList.contains('collection-link')"), true, 'successful rename restores trigger focus');
  // Duplicate names reject without losing assignments or leaving controls busy.
  await action(second.id, "rename");
  await fill("[data-rename-id]", "Workflow A");
  await key("Enter");
  await until("document.querySelector('#status').classList.contains('error') && !document.querySelector('#show-create').disabled");
  assert.equal((await snapshot()).collections.find(item => item.id === second.id).name, "Workflow Renamed");
  await key("Escape");
  await click(collectionSelector(""));

  assert.equal(await evaluate("document.querySelector('.manage-collections').querySelectorAll('svg').length===1 && document.querySelector('.manage-collections').textContent==='' && document.querySelector('.manage-collections').getAttribute('aria-label').startsWith('Manage collections for ') && document.querySelector('.manage-collections').title==='Manage collections' && document.querySelector('.author-row .xivary-follow-button').textContent==='Following' && document.querySelector('.author-row .xivary-follow-button').getAttribute('aria-label').startsWith('Unfollow:')"), true);
  await evaluate("document.querySelector('.author-row h2 a').focus()");
  await key("Tab");
  assert.equal(await evaluate("document.activeElement.classList.contains('manage-collections') && document.activeElement.matches(':focus-visible')"), true);
  assert.equal(await evaluate("(()=>{const button=document.querySelector('.manage-collections'),r=button.getBoundingClientRect();return r.width===34&&r.height===34&&getComputedStyle(button).borderRadius==='7px'})()"),true);
  await screenshot("folder-trigger.png");
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  assert.equal(await evaluate("document.querySelector('.collection-picker-subtitle').textContent.includes('last collection')"), true);
  async function membership(id, enabled) {
    await click(checkbox(id));
    await until(`(!document.querySelector('.arxiv-collection-picker') && document.querySelectorAll('.author-row').length===0) || (document.querySelector(${JSON.stringify(checkbox(id))})?.checked === ${enabled} && !document.querySelector(${JSON.stringify(checkbox(id))})?.disabled && document.querySelector('.collection-picker-status').textContent === '')`);
  }
  await pickerVisualWorkflow({evaluate, key, screenshot});
  await screenshot("folder-picker.png");
  await evaluate(`document.querySelector(${JSON.stringify(checkbox(first.id))}).focus()`);
  await key(' ');
  await until(`document.querySelector(${JSON.stringify(checkbox(first.id))})?.checked && !document.querySelector(${JSON.stringify(checkbox(first.id))})?.disabled && document.querySelector('.collection-picker-status').textContent === ''`);
  for (const id of previous) await membership(id, false);
  assert.deepEqual((await snapshot()).memberships.filter(item => item.authorId === author.id).map(item => item.collectionId), [first.id]);
  await click(".collection-picker-heading button");
  assert.equal(await evaluate("document.activeElement.classList.contains('manage-collections')"), true);
  await click(collectionSelector(first.id));
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1);
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await membership(second.id, true);
  await membership(first.id, false);
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 0);
  await key("Escape");
  assert.equal(await evaluate("document.activeElement.dataset.collectionId"), first.id, "closing picker after filtered author leaves restores collection focus");
  await click(collectionSelector(second.id));
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1);
  await screenshot();
  const moved = await snapshot();
  assert.deepEqual(moved.authors, original.authors, "moving retains author metadata");
  assert.deepEqual(await bookmarks(), papers);
  await reload();
  await until("document.querySelectorAll('.author-row').length===1 && !document.querySelector('#collection-sidebar').hidden");
  await click(collectionSelector(second.id));
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1);
  await preference(false);
  assert.deepEqual((await snapshot()).memberships, moved.memberships);
  await reload();
  await until("document.querySelector('#collection-sidebar')?.hidden && document.querySelectorAll('.author-row').length===1");
  await preference(true);
  await click(collectionSelector(second.id));
  const beforeEscape = await snapshot();
  await action(second.id, "delete");
  assert.equal(await evaluate("document.activeElement.textContent==='Cancel' && getComputedStyle(document.querySelector('.collection-delete-dialog')).borderRadius==='14px' && document.querySelector('[data-confirm-id]').classList.contains('button-danger')"), true);
  await screenshot("collection-delete-dialog.png");
  await key("Escape");
  assert.equal(await evaluate("!document.querySelector('.collection-delete-dialog') && document.activeElement.matches('.collection-link')"), true);
  assert.deepEqual(await snapshot(), beforeEscape);
  await action(second.id, "delete");
  assert.equal(await evaluate("document.querySelector('.collection-delete-dialog').open && document.querySelector('.collection-delete-dialog').textContent.includes('become unfollowed')"), true);
  await key("Escape");
  assert.equal((await snapshot()).memberships.length, 1, "cancel preserves sole membership");
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await membership(second.id, false);
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 0, "last membership removal unfollows immediately");
  assert.deepEqual((await snapshot()).authors, original.authors);
  await until("!document.querySelector('.arxiv-collection-picker')");
  await click(".xivary-undo-stack .xivary-undo:last-child button");
  await until("document.querySelectorAll('.author-row').length===1");
  // Restore original memberships through the picker before deleting test groups.
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  for (const id of previous) await membership(id, true);
  await click(".collection-picker-heading button");
  await action(second.id, "delete");
  assert.equal(await evaluate("document.querySelector('.collection-delete-dialog').textContent.includes('other collections remain followed')"), true);
  await click("[data-confirm-id]");
  await settled();
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1, "deleting group retains author followed in another");
  await click(collectionSelector(first.id));
  await action(first.id, "delete");
  await click("[data-confirm-id]");
  await settled();
  await preference(false);
  const final = await snapshot();
  assert.deepEqual(final.collections, original.collections);
  assert.deepEqual(final.authors, original.authors);
  assert.deepEqual(final.memberships.map(({ authorId, collectionId }) => ({ authorId, collectionId })), original.memberships.map(({ authorId, collectionId }) => ({ authorId, collectionId })));
  assert.deepEqual(await bookmarks(), papers);
  await click(".author-row .actions button:last-child");
  await until("document.querySelectorAll('.author-row').length===0 && document.querySelector('.xivary-undo button')");
  await click(".xivary-undo-stack .xivary-undo:last-child button");
  await until("document.querySelectorAll('.author-row').length===1");
  assert.deepEqual((await snapshot()).memberships, final.memberships);
  console.log("Following workflow PASS: toggle, defaults, create/rename/errors/cancel/delete, assign/move, counts/filter, reload, metadata and Bookmark isolation");
}

// Shared native-browser interaction checks: no repository writes occur here.
export async function collectionMenuWorkflow({ evaluate, click, key, screenshot = async () => {} }) {
  const trigger = '.collection-link[data-collection-id]:not([data-collection-id=""])';
  const original = await evaluate("document.querySelector('.collection-link[aria-current]').dataset.collectionId");
  const geometry = () => evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row'),count=row.querySelector('.collection-count'),r=count.getBoundingClientRect();return [count.textContent,r.x,r.y,r.width,r.height]})()`);
  const before = await geometry();
  const savedCount = await evaluate(`document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row').querySelector('.collection-count').textContent`);
  await evaluate(`document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row').querySelector('.collection-count').textContent='123456'`);
  assert.equal(await evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row'),name=row.querySelector('.collection-name').getBoundingClientRect(),count=row.querySelector('.collection-count').getBoundingClientRect();return name.right<=count.left&&count.right<=row.getBoundingClientRect().right&&document.documentElement.scrollWidth===document.documentElement.clientWidth})()`),true);
  await evaluate(`document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row').querySelector('.collection-count').textContent=${JSON.stringify(savedCount)}`);
  assert.equal(await evaluate("!document.querySelector('.collection-menu-trigger,.collection-actions')"),true);
  await click(trigger,{button:'right'});
  assert.equal(await evaluate("Boolean(document.querySelector('.collection-menu')) && document.activeElement.dataset.action==='rename'"),true);
  assert.equal(await evaluate("document.querySelector('.collection-link[aria-current]').dataset.collectionId"),original,'right click does not select');
  assert.deepEqual(await geometry(),before);
  await screenshot('collection-menu.png');
  await key('ArrowDown'); assert.equal(await evaluate("document.activeElement.dataset.action"),'delete');
  await key('Home'); assert.equal(await evaluate("document.activeElement.dataset.action"),'rename');
  await key('End'); assert.equal(await evaluate("document.activeElement.dataset.action"),'delete');
  await key('Escape');
  assert.equal(await evaluate("!document.querySelector('.collection-menu') && document.activeElement.matches('.collection-link')"),true);
  await key('Shift+F10');
  assert.equal(await evaluate("document.activeElement.dataset.action"),'rename');
  assert.equal(await evaluate("(async()=>{window.dispatchEvent(new Event('focus'));const {RepositoryClient}=await import('../repository/repository-client.js');await new RepositoryClient().getPreferences();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return document.activeElement.dataset.action==='rename'&&Boolean(document.querySelector('.collection-menu'))})()"),true);
  await key('Escape'); await key('ContextMenu');
  assert.equal(await evaluate("document.activeElement.dataset.action"),'rename');
  await key('Tab'); assert.equal(await evaluate("!document.querySelector('.collection-menu')"),true);
  for (const edge of ['left','right','bottom']) {
    await evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row');row.style.cssText='position:fixed;z-index:1;width:250px;';row.style.left=${JSON.stringify(edge)}==='right'?(innerWidth-258)+'px':'8px';row.style.top=${JSON.stringify(edge)}==='bottom'?(innerHeight-52)+'px':'8px';})()`);
    await click(trigger,{button:'right'});
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.collection-menu').getBoundingClientRect();return r.left>=8&&r.right<=document.documentElement.clientWidth-8&&r.top>=8&&r.bottom<=document.documentElement.clientHeight-8})()"),true);
    await screenshot(`collection-menu-${edge}.png`);await key('Escape');
    await evaluate(`document.querySelector(${JSON.stringify(trigger)}).closest('.collection-row').removeAttribute('style')`);
  }
  await click(trigger,{double:true});
  assert.equal(await evaluate("(()=>{const input=document.querySelector('[data-rename-id]');return Boolean(input)&&document.activeElement===input&&input.selectionStart===0&&input.selectionEnd===input.value.length})()"),true,'native double click selects and starts rename');
  assert.equal(await evaluate("(()=>{const input=document.querySelector('[data-rename-id]'),event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});input.dispatchEvent(event);return !event.defaultPrevented&&!document.querySelector('.collection-menu')})()"),true,'rename input keeps native text context menu');
  await screenshot('collection-rename.png');await key('Escape');
  await key('F2');assert.equal(await evaluate("Boolean(document.querySelector('[data-rename-id]'))"),true);await key('Escape');
  await key('Shift+F10');await click('h1');assert.equal(await evaluate("!document.querySelector('.collection-menu')"),true);
  await click('.collection-link[data-collection-id=""]');
  assert.equal(await evaluate("document.querySelector('.collection-link[aria-current]').dataset.collectionId"),'');
  if(original) await click(`.collection-link[data-collection-id=${JSON.stringify(original)}]`);
  assert.deepEqual(await geometry(),before);
  await renameOutsideWorkflow({evaluate,click,until:async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(expression);},key});
}

export async function pickerVisualWorkflow({ evaluate, key, screenshot = async () => {} }) {
  const shape = "(()=>{const panel=document.querySelector('.arxiv-collection-picker');return [...panel.querySelectorAll('input,button')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})})()";
  const before = await evaluate(shape);
  assert.equal(await evaluate("(()=>{const panel=document.querySelector('.arxiv-collection-picker'),boxes=[...panel.querySelectorAll('input[type=checkbox]')];return boxes.length>0&&boxes.every(box=>{const s=getComputedStyle(box),r=box.getBoundingClientRect();return box.type==='checkbox'&&s.borderRadius==='4px'&&r.width===17&&r.height===17&&s.backgroundColor===(box.checked?'rgb(85, 91, 99)':'rgb(255, 255, 255)')})&&getComputedStyle(panel.querySelector('input[type=text]')).borderRadius==='8px'&&getComputedStyle(panel.querySelector('button[type=submit]')).borderRadius==='8px'&&panel.scrollWidth===panel.clientWidth})()"),true);
  await evaluate("document.querySelector('.arxiv-collection-picker').focus()");
  await key('Tab'); await key('Tab');
  assert.equal(await evaluate("document.activeElement.matches('input[type=checkbox]:focus-visible') && getComputedStyle(document.activeElement).outlineStyle==='solid'"),true);
  await screenshot('picker-checkbox-focus.png');
  await evaluate("[...document.querySelectorAll('.arxiv-collection-picker input[type=checkbox]')].at(-1).focus()");
  await key('Tab');
  assert.equal(await evaluate("document.activeElement.matches('input[type=text]:focus-visible')"),true);
  await screenshot('picker-input-focus.png');
  await key('Tab');
  assert.equal(await evaluate("document.activeElement.matches('button[type=submit]:focus-visible')"),true);
  await screenshot('picker-create-focus.png');
  assert.deepEqual(await evaluate(shape),before,'focus does not change control geometry');
}

export async function renameOutsideWorkflow({ evaluate, click, until, key }) {
  const entry = await evaluate("(()=>{const button=document.querySelector('.collection-link[data-collection-id]:not([data-collection-id=\"\"])'),row=button.closest('.collection-row');return {id:row.querySelector('.collection-link').dataset.collectionId,name:row.querySelector('.collection-label').textContent,selected:document.querySelector('.collection-link[aria-current]').dataset.collectionId,path:location.pathname,kind:location.pathname.includes('/library/')?'bookmarks':'following'}})()");
  const trigger = `.collection-link[data-collection-id=${JSON.stringify(entry.id)}]`;
  const state = () => evaluate(`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const {exportedAt,...data}=await new RepositoryClient().exportCategory(${JSON.stringify(entry.kind)});return data})()`);
  const original = await state();
  async function edit() { await evaluate(`document.querySelector(${JSON.stringify(trigger)}).focus()`); await key("F2"); await evaluate("document.querySelector('[data-rename-id]').value='Discard this rename'"); }
  await edit(); await click('[data-rename-id]');
  assert.equal(await evaluate("Boolean(document.querySelector('[data-rename-id]'))"),true,'inside click retains editing');
  await click('h1');
  assert.equal(await evaluate("!document.querySelector('[data-rename-id]')"),true);
  assert.deepEqual(await state(),original,'outside cancellation never writes');
  await edit(); await key('Escape');
  assert.equal(await evaluate("!document.querySelector('[data-rename-id]') && document.activeElement.classList.contains('collection-link')"),true);
  await edit(); await click('.collection-link[data-collection-id=""]');
  assert.equal(await evaluate("!document.querySelector('[data-rename-id]') && document.querySelector('.collection-link[aria-current]').dataset.collectionId===''"),true,'one click cancels and selects aggregate');
  assert.deepEqual(await state(),original);
  const other = await evaluate(`([...document.querySelectorAll('.collection-link')].find(button=>button.dataset.collectionId&&button.dataset.collectionId!==${JSON.stringify(entry.id)})?.dataset.collectionId)`);
  if (other) {
    await edit(); await click(`.collection-link[data-collection-id=${JSON.stringify(other)}]`);
    assert.equal(await evaluate(`!document.querySelector('[data-rename-id]') && document.querySelector('.collection-link[aria-current]').dataset.collectionId===${JSON.stringify(other)}`),true,'one click selects another named collection');
    assert.deepEqual(await state(),original);
  }
  await edit(); await click('.settings-link');
  await until("document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");
  await click(`.app-nav a[href*=${JSON.stringify(entry.kind==='bookmarks'?'library':'authors')}]`);
  await until("document.querySelector('.collection-link[data-collection-id]:not([data-collection-id=\"\"])') && !document.querySelector('.collection-link').disabled");
  assert.equal(await evaluate("!document.querySelector('[data-rename-id]')"),true,'navigation completes on its first click');
  assert.deepEqual(await state(),original,'navigation does not save rename');
  if (entry.selected) await click(`.collection-link[data-collection-id=${JSON.stringify(entry.selected)}]`);
}

export async function pickerPositionWorkflow({ evaluate, until, click, resize, screenshot = async () => {} }) {
  const run = code => evaluate(`(()=>{${code}})()`);
  const settle = () => evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await evaluate("(()=>{const panel=document.querySelector('.arxiv-collection-picker'),anchor=document.querySelector('[aria-haspopup=dialog][aria-expanded=true]');window.positionFixture={panel,anchor,parent:anchor.parentNode,next:anchor.nextSibling,style:anchor.style.cssText,width:innerWidth,height:innerHeight,input:panel.querySelector('input[type=text]')};anchor.dataset.positionFixture='true';})()");
  const bounded = () => evaluate("(()=>{const r=positionFixture.panel.getBoundingClientRect();return r.left>=7.9&&r.right<=document.documentElement.clientWidth-7.9&&r.top>=7.9&&r.bottom<=document.documentElement.clientHeight-7.9&&positionFixture.panel.scrollWidth===positionFixture.panel.clientWidth})()");
  await settle();assert.equal(await bounded(),true);
  assert.equal(await evaluate("(()=>{const p=positionFixture.panel.getBoundingClientRect(),a=positionFixture.anchor.getBoundingClientRect();return positionFixture.panel.dataset.placement==='below'&&Math.abs(p.top-a.bottom-7)<1})()"),true);
  await screenshot('picker-below.png');
  await run("positionFixture.anchor.style.cssText+=';position:fixed;right:8px;left:auto;top:'+(innerHeight-44)+'px';positionFixture.input.focus();positionFixture.input.value='Preserve this input';");
  await settle();assert.equal(await bounded(),true);
  assert.equal(await evaluate("(()=>{const p=positionFixture.panel.getBoundingClientRect(),a=positionFixture.anchor.getBoundingClientRect();return positionFixture.panel.dataset.placement==='above'&&Math.abs(a.top-p.bottom-7)<1&&Math.abs(a.right-p.right)<1&&document.activeElement===positionFixture.input})()"),true);
  await screenshot('picker-above-right.png');
  await resize(360,340);
  await run("positionFixture.anchor.style.top=(innerHeight/2-18)+'px'");await settle();
  assert.equal(await bounded(),true);
  assert.equal(await evaluate("positionFixture.panel.getBoundingClientRect().height<300&&positionFixture.input.value==='Preserve this input'&&document.activeElement===positionFixture.input"),true);
  await run("positionFixture.panel.scrollTop=positionFixture.panel.scrollHeight");await settle();
  assert.equal(await evaluate("positionFixture.panel.scrollTop>=positionFixture.panel.scrollHeight-positionFixture.panel.clientHeight-1"),true,'position updates preserve constrained scrolling to creation controls');
  await screenshot('picker-narrow-constrained.png');
  const originalSize=await evaluate("[positionFixture.width,positionFixture.height]");await resize(...originalSize);
  await run("positionFixture.anchor.style.top='8px'");await settle();
  const kind=await evaluate("positionFixture.panel.getAttribute('aria-label').startsWith('Collections for')?'following':'bookmarks'");
  const name='Position fixture collection with a long scientific classification';
  await run(`positionFixture.input.value=${JSON.stringify(name)};positionFixture.panel.querySelector('form').requestSubmit()`);
  await until(`Boolean([...document.querySelectorAll('.arxiv-collection-picker label')].find(label=>label.textContent===${JSON.stringify(name)}&&label.querySelector('input').checked&&!label.querySelector('input').disabled))`);
  await settle();assert.equal(await bounded(),true);await screenshot('picker-created.png');
  await run(`positionFixture.input.value=${JSON.stringify(name)};positionFixture.panel.querySelector('form').requestSubmit()`);
  await until("document.querySelector('.collection-picker-status')?.textContent.includes('already exists')");
  await settle();assert.equal(await bounded(),true);await screenshot('picker-validation.png');
  await run("positionFixture.anchor.style.cssText=positionFixture.style;positionFixture.filler=document.createElement('div');positionFixture.filler.style.height='1200px';document.body.append(positionFixture.filler)");
  await settle();const before=await evaluate("positionFixture.panel.getBoundingClientRect().top");
  await evaluate("window.scrollBy(0,48)");await settle();assert.equal(await bounded(),true);
  assert.notEqual(await evaluate("positionFixture.panel.getBoundingClientRect().top"),before,'scroll reanchors picker');
  await screenshot('picker-scrolled.png');
  await run("positionFixture.filler.remove();window.scrollTo(0,0)");await settle();
  await run("positionFixture.anchor.remove()");
  await until("!document.querySelector('.arxiv-collection-picker')");
  await run("positionFixture.anchor.style.cssText=positionFixture.style;positionFixture.parent.insertBefore(positionFixture.anchor,positionFixture.next)");
  await evaluate(`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();const library=await repository.${kind==='following'?'getAuthorLibrary':'getPaperLibrary'}();const collection=library.collections.find(item=>item.name===${JSON.stringify(name)});await repository.${kind==='following'?'deleteAuthorCollection':'deletePaperCollection'}(collection.id)})()`);
  await click('[data-position-fixture]');await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await click('.collection-picker-heading button');assert.equal(await evaluate("!document.querySelector('.arxiv-collection-picker')&&document.activeElement===positionFixture.anchor"),true);
  await run("positionFixture.anchor.removeAttribute('data-position-fixture');delete window.positionFixture");
}


export async function authorPositionRowsWorkflow({evaluate,until,click,resize,screenshot}) {
  const setup=await evaluate("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();const settings=await repository.getPreferences();const authors=[];for(const displayName of ['Boundary Fixture Researcher','Long Named Researcher for Contextual Geometry Testing']) authors.push(await repository.followAuthor({displayName}));await repository.setOrganizeFollowedAuthorsIntoCollections(true);window.dispatchEvent(new Event('focus'));return {settings,ids:authors.map(author=>author.id)}})()");
  await until("document.querySelectorAll('.author-row').length===3 && document.querySelectorAll('.manage-collections').length===3");
  for(let index=0;index<3;index++) {
    const selector=`.author-row:nth-child(${index+1}) .manage-collections`;
    await click(selector);await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await evaluate("(()=>{const p=document.querySelector('.arxiv-collection-picker').getBoundingClientRect(),a=document.querySelector('.manage-collections[aria-expanded=true]').getBoundingClientRect();return p.left>=8&&p.right<=innerWidth-8&&p.top>=8&&p.bottom<=innerHeight-8&&Math.abs(p.right-a.right)<1})()"),true);
    await screenshot(`picker-author-${['first','middle','last'][index]}.png`);
    if(index===2) await pickerPositionWorkflow({evaluate,until,click,resize,screenshot});
    else await click('.collection-picker-heading button');
  }
  await evaluate(`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();for(const id of ${JSON.stringify(setup.ids)})await repository.unfollowAuthor(id);await repository.setOrganizeFollowedAuthorsIntoCollections(${setup.settings.organizeFollowedAuthorsIntoCollections});window.dispatchEvent(new Event('focus'))})()`);
  await until("document.querySelectorAll('.author-row').length===1");
}
