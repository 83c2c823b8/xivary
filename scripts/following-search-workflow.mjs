import assert from "node:assert/strict";

export async function followingSearchWorkflow({ evaluate, click, key, type, until, reload, resize, screenshot }) {
  const run = code => evaluate(`(()=>{${code}})()`);
  const rpc = code => evaluate(`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repo=new RepositoryClient();return ${code}})()`);
  const portable = () => rpc("repo.exportCategory('following',{kind:'all'}).then(({exportedAt,...data})=>data)");
  const original = await portable();
  const settings = await rpc('repo.getPreferences()');
  const refresh = async () => { await run("window.dispatchEvent(new Event('focus'))"); await until("!document.querySelector('#filter').disabled"); };
  await until("document.querySelectorAll('.author-row').length===1");
  await resize(1100, 850);
  assert.equal(await evaluate("document.querySelector('#filter').value"), '');
  assert.equal(await evaluate("document.querySelector('#count').textContent"), '1 author');
  await screenshot('following-search-normal.png');

  // Native Tab reaches the ordinary search input; native typing triggers filtering.
  await run("document.querySelector('.settings-link').focus()"); await key('Tab');
  assert.equal(await evaluate("document.activeElement.id==='filter' && document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0"), true);
  await type('no matching researcher');
  await until("document.querySelector('#count').textContent==='0 of 1 authors'");
  assert.equal(await evaluate("document.querySelector('label[for=filter]').textContent"), 'Search followed authors');
  await screenshot('following-search-keyboard.png');
  const filter = query => run(`const input=document.querySelector('#filter');input.value=${JSON.stringify(query)};const before=window.searchProbe?.calls.length;input.dispatchEvent(new Event('input',{bubbles:true}));if(window.searchProbe&&window.searchProbe.calls.length!==before)throw Error('Filtering made a repository request');`);
  await filter('');
  // With genuinely no follows, retain the original empty state even with a query.
  const name = await evaluate("document.querySelector('.author-row h2 a').textContent");
  await filter(name); await click('.author-row .xivary-follow-button');
  await until("document.querySelector('#count').textContent==='0 authors' && document.querySelector('.xivary-undo button')");
  assert.equal(await evaluate("document.querySelector('#empty').textContent"), 'No followed researchers.');
  await screenshot('following-search-empty.png');
  await click('.xivary-undo button');
  await until("document.querySelector('#count').textContent==='1 of 1 authors'");
  assert.equal(await evaluate("document.querySelector('#filter').value"), name);
  await filter('');

  const fixtures = await rpc("(async()=>{const records=[];for(const displayName of ['Boundary Search Researcher','Another Search Researcher']) records.push(await repo.followAuthor({displayName}));return records})()");
  await refresh(); await until("document.querySelectorAll('.author-row').length===3");
  const before = await rpc("Promise.all([repo.getAuthorLibrary(),repo.getPaperLibrary()])");
  await evaluate("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const original=RepositoryClient.prototype.request;const fetch=window.fetch;window.searchProbe={calls:[],requests:0,rows:[...document.querySelectorAll('.author-row')],names:[...document.querySelectorAll('.author-row h2 a')].map(n=>n.textContent),original,fetch};RepositoryClient.prototype.request=function(method,...args){searchProbe.calls.push(method);return original.call(this,method,...args)};window.fetch=(...args)=>{searchProbe.requests++;return fetch(...args)}})()");
  for (const query of ['Researcher', 'SEARCH researcher', '  search  ', 'Boundary Search Researcher']) {
    await filter(query);
    const expected = await evaluate(`searchProbe.names.filter(name=>name.toLowerCase().includes(${JSON.stringify(query.trim().toLowerCase())}))`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.author-row h2 a')].map(n=>n.textContent)"), expected);
    assert.equal(await evaluate("document.querySelector('#count').textContent"), `${expected.length} of 3 authors`);
  }
  await screenshot('following-search-matching.png');
  await filter('missing');
  assert.equal(await evaluate("document.querySelector('#empty').textContent==='No matching authors.' && !document.querySelector('#empty').hidden"), true);
  await screenshot('following-search-no-matches.png');
  await filter(' \t ');
  assert.equal(await evaluate("document.querySelector('#count').textContent"), '3 authors');
  await filter('');
  assert.equal(await evaluate("[...document.querySelectorAll('.author-row')].every((row,i)=>row===searchProbe.rows[i])"), true, 'clearing reuses cached rows in their original order');
  assert.equal(await evaluate("searchProbe.requests"), 0);
  assert.deepEqual(await rpc("Promise.all([repo.getAuthorLibrary(),repo.getPaperLibrary()])"), before, 'search changes no library records, settings or portable state');
  await run("window.fetch=searchProbe.fetch;searchProbe.original && (window.searchOriginal=searchProbe.original)");
  await evaluate("import('../repository/repository-client.js').then(({RepositoryClient})=>{RepositoryClient.prototype.request=window.searchOriginal})");

  await filter('Boundary'); await refresh();
  await until("document.querySelectorAll('.author-row').length===1");
  assert.equal(await evaluate("document.querySelector('#filter').value"), 'Boundary');
  await click('.author-row .xivary-follow-button');
  await until("document.querySelector('#count').textContent==='0 of 2 authors' && document.querySelector('.xivary-undo button')");
  assert.equal(await evaluate("document.querySelector('#empty').textContent"), 'No matching authors.');
  await screenshot('following-search-unfollowed.png');
  await click('.xivary-undo button');
  await until("document.querySelector('#count').textContent==='1 of 3 authors'");

  await rpc('repo.setOrganizeFollowedAuthorsIntoCollections(true)'); await refresh();
  await until("!document.querySelector('#collection-sidebar').hidden && document.querySelectorAll('.author-row').length===1");
  assert.equal(await evaluate("document.querySelector('.collection-count').textContent"), '3');
  const library = await rpc('repo.getAuthorLibrary()');
  const collection = library.collections.find(c => library.memberships.some(m => m.collectionId === c.id && m.authorId === fixtures[0].id));
  await click(`.collection-link[data-collection-id=${JSON.stringify(collection.id)}]`);
  assert.equal(await evaluate("document.querySelector('#filter').value"), 'Boundary');
  await click('.collection-link[data-collection-id=""]');
  await resize(360, 700); await screenshot('following-search-narrow.png');
  assert.equal(await evaluate("document.documentElement.scrollWidth===document.documentElement.clientWidth && document.querySelector('#filter').getBoundingClientRect().right<=document.documentElement.clientWidth"), true);
  await filter('/');
  assert.equal(await evaluate("document.querySelector('#filter').value"), '/', 'slash remains plain input, without shortcuts');
  await reload();
  await until("document.querySelector('#filter')?.value==='' && document.querySelectorAll('.author-row').length===3");
  assert.equal(await evaluate("[...document.querySelectorAll('.author-row h2 a')].every(a=>a.getAttribute('href').startsWith('../author/author.html?authorId='))"), true);
  await rpc(`(async()=>{for(const id of ${JSON.stringify(fixtures.map(a => a.id))})await repo.unfollowAuthor(id);await repo.setOrganizeFollowedAuthorsIntoCollections(${settings.organizeFollowedAuthorsIntoCollections})})()`);
  await refresh(); await until("document.querySelectorAll('.author-row').length===1");
  assert.deepEqual(await portable(), original, 'fixture cleanup preserves original following/memberships');
  await resize(1280, 900);
  console.log('FOLLOWING SEARCH PASS: local matching/order/counts/empty/clear, native Tab/typing, cached rows, unfollow/Undo, collection composition, reload and unchanged data');
}
