import assert from 'node:assert/strict';

export async function authorFilterWorkflow({evaluate, click, key, until, resize, screenshot=async()=>{}, queries=['alex kim']}) {
  const run=code=>evaluate(`(()=>{${code}})()`);
  const count=()=>evaluate("document.querySelectorAll('.paper-row').length");
  const input=async value=>run(`document.querySelector('#paper-query').value=${JSON.stringify(value)};document.querySelector('#paper-query').dispatchEvent(new Event('input',{bubbles:true}))`);
  const choose=async range=>{await click('#date-range');await click(`.time-menu [data-range="${range}"]`);};
  const years=async(from,to)=>run(`document.querySelector('#year-from').value=${JSON.stringify(from)};document.querySelector('#year-to').value=${JSON.stringify(to)};for(const id of ['year-from','year-to'])document.getElementById(id).dispatchEvent(new Event('input',{bubbles:true}))`);
  await until("document.querySelectorAll('.paper-row').length===1");
  assert.equal(await evaluate("document.querySelector('#filters').hidden && !document.querySelector('select,input[type=date]')"),true);
  await screenshot('author-search-closed.png');
  await click('#show-filters');assert.equal(await evaluate("!document.querySelector('#filters').hidden && document.activeElement.id==='paper-query'"),true);
  assert.equal(await evaluate("(()=>{const a=document.querySelector('#paper-query').getBoundingClientRect(),b=document.querySelector('#date-range').getBoundingClientRect();return a.height===38&&b.height===38&&Math.abs(a.top-b.top)<2&&getComputedStyle(document.querySelector('#paper-query')).fontSize===getComputedStyle(document.querySelector('#date-range')).fontSize})()"),true,JSON.stringify(await evaluate("[...document.querySelectorAll('#paper-query,#date-range')].map(n=>({rect:n.getBoundingClientRect().toJSON(),font:getComputedStyle(n).fontSize,min:getComputedStyle(n).minHeight}))")));
  await screenshot('author-search-empty.png');await click('h1');assert.equal(await evaluate("document.querySelector('#filters').hidden"),true);
  await click('#show-filters');for(const query of queries){await input(query);assert.equal(await count(),1);}
  await click('h1');assert.equal(await evaluate("!document.querySelector('#filters').hidden"),true);
  await screenshot('author-search-query.png');await click('#show-filters');
  assert.equal(await evaluate("document.querySelector('#filters').hidden&&document.querySelector('#show-filters').classList.contains('active-filter')&&document.querySelector('#show-filters').title.includes('active')&&document.querySelector('#filter-count').textContent==='1 paper'"),true);
  await click('#show-filters');assert.equal(await evaluate(`document.querySelector('#paper-query').value===${JSON.stringify(queries.at(-1))}`),true);
  await key('Escape');assert.equal(await evaluate("document.querySelector('#filters').hidden&&document.activeElement.id==='show-filters'"),true);
  await click('#show-filters');await input('missing');assert.equal(await count(),0);await screenshot('author-no-matches.png');await input('');assert.equal(await count(),1);
  await click('#date-range');assert.deepEqual(await evaluate("[...document.querySelectorAll('.time-menu button')].map(b=>b.textContent.trim())"),['✓Any time','Past year','Past 3 years','Custom…']);
  assert.equal(await evaluate("(()=>{const m=document.querySelector('.time-menu'),r=m.getBoundingClientRect(),b=m.querySelector('[aria-checked=true]');return m.getAttribute('role')==='menu'&&b.getAttribute('role')==='menuitemradio'&&getComputedStyle(b).backgroundColor==='rgb(241, 243, 244)'&&r.left>=8&&r.right<=document.documentElement.clientWidth-8})()"),true);
  await screenshot('author-time-menu.png');await key('ArrowDown');await key('ArrowUp');assert.equal(await evaluate("document.activeElement.dataset.range==='any'"),true);await key('ArrowDown');assert.equal(await evaluate("document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0"),true);await screenshot('author-time-menu-focus.png');await key('Enter');assert.equal(await evaluate("document.querySelector('#range-label').textContent==='Past year'&&document.activeElement.id==='date-range'"),true,JSON.stringify(await evaluate("({range:document.querySelector('#range-label').textContent,focus:document.activeElement.outerHTML,menu:document.querySelector('.time-menu')?.outerHTML})")));assert.equal(await count(),1);
  await click('#date-range');await key('ArrowDown');await key(' ');assert.equal(await evaluate("document.querySelector('#range-label').textContent==='Past 3 years'"),true);assert.equal(await count(),1);
  await click('#date-range');await key('ArrowDown');await key('Escape');assert.equal(await evaluate("!document.querySelector('.time-menu')&&document.querySelector('#range-label').textContent==='Past 3 years'"),true);
  await click('#date-range');await click('#date-range');assert.equal(await evaluate("!document.querySelector('.time-menu')"),true);
  await click('#date-range');await click('h1');assert.equal(await evaluate("!document.querySelector('.time-menu')"),true);
  await choose('custom');assert.equal(await evaluate("!document.querySelector('#custom-years').hidden&&document.querySelector('#range-label').textContent==='Past 3 years'&&document.querySelector('#year-feedback').textContent.includes('Apply')"),true);
  await years('2020','2026');await click('#custom-years button[type=submit]');assert.equal(await count(),1);await screenshot('author-custom-years.png');
  await years('202','2026');assert.equal(await count(),1,'incomplete drafts do not filter');await click('#custom-years button[type=submit]');
  assert.equal(await evaluate("document.querySelector('#year-feedback').textContent.includes('four-digit')&&document.querySelector('#range-label').textContent==='2020–2026'&&document.querySelector('#date-range').getAttribute('aria-label')==='Publication time: 2020–2026'"),true);assert.equal(await count(),1);await screenshot('author-invalid-years.png');
  await years('2026','2020');await click('#custom-years button[type=submit]');assert.equal(await evaluate("document.querySelector('#year-feedback').textContent.includes('later')"),true);
  await years('0999','2026');await click('#custom-years button[type=submit]');assert.equal(await evaluate("document.querySelector('#year-from').getAttribute('aria-invalid')==='true'"),true);
  await choose('year');assert.equal(await evaluate("document.querySelector('#custom-years').hidden"),true);
  await choose('custom');assert.equal(await evaluate("document.querySelector('#year-from').value==='2020'&&document.querySelector('#year-to').value==='2026'&&document.querySelector('#range-label').textContent==='Past year'"),true);
  await click('#custom-years button[type=submit]');await input('alex kim');assert.equal(await count(),1);
  await run("window.dispatchEvent(new Event('focus'))");await until("!document.querySelector('#follow-author').disabled");assert.equal(await evaluate("document.querySelector('#year-from').value==='2020'&&document.querySelector('#range-label').textContent==='2020–2026'&&document.querySelector('#date-range').getAttribute('aria-label')==='Publication time: 2020–2026'"),true);
  const size=await evaluate('[innerWidth,innerHeight]');await resize(360,600);
  const originalName=await evaluate("document.querySelector('#name').textContent");await run("document.querySelector('#name').textContent='Alex Kim with a very long research display name'");
  assert.equal(await evaluate("document.querySelector('#refresh').getBoundingClientRect().width===38&&document.documentElement.scrollWidth===document.documentElement.clientWidth&&[...document.querySelectorAll('.author-tools button,.custom-years input')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=document.documentElement.clientWidth})"),true);await screenshot('author-years-narrow.png');
  await resize(...size);await run(`document.querySelector('#name').textContent=${JSON.stringify(originalName)}`);
  await years('','2025');await click('#custom-years button[type=submit]');assert.equal(await count(),0,'open-ended To includes only through the chosen year');
  await click('#clear-years');assert.equal(await evaluate("document.querySelector('#custom-years').hidden&&document.querySelector('#range-label').textContent==='Any time'"),true);assert.equal(await count(),1);
  await click('#show-filters');await input('');await key('Escape');
  assert.equal(await evaluate("document.querySelector('#filters').hidden&&!document.querySelector('#show-filters').classList.contains('active-filter')"),true);
  await run("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true,cancelable:true}))");assert.equal(await evaluate("document.activeElement.id==='paper-query'"),true);await key('Escape');
}

export async function authorHeaderWorkflow({evaluate,click,until,resize,screenshot=async()=>{}}) {
  const run=code=>evaluate(`(()=>{${code}})()`);
  const rpc=code=>evaluate(`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();${code}})()`);
  const preferences=await rpc('return await repository.getPreferences()');
  await rpc('await repository.setOrganizeFollowedAuthorsIntoCollections(true)');await run("window.dispatchEvent(new Event('focus'))");
  await until("!document.querySelector('#author-collections').hidden && !document.querySelector('#author-collections').disabled");
  assert.equal(await evaluate("(()=>{const b=document.querySelector('#author-collections');return b.textContent===''&&b.querySelectorAll('svg').length===1&&b.getAttribute('aria-label')==='Manage collections for Alex Kim'&&b.title==='Manage collections'&&b.getBoundingClientRect().width===34&&document.querySelector('#follow-author').textContent==='Following'})()"),true);
  await click('#author-collections');await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await screenshot('author-header-picker.png');
  await run("document.querySelector('.arxiv-collection-picker input[type=text]').value='Author header fixture';document.querySelector('.arxiv-collection-picker form').requestSubmit()");
  await until("[...document.querySelectorAll('.arxiv-collection-picker label')].some(n=>n.textContent==='Author header fixture'&&n.querySelector('input').checked&&!n.querySelector('input').disabled)");
  const id=await evaluate("[...document.querySelectorAll('.arxiv-collection-picker label')].find(n=>n.textContent==='Author header fixture').querySelector('input').value");
  await click(`.arxiv-collection-picker input[value="${id}"]`);
  await until(`!document.querySelector('.arxiv-collection-picker input[value="${id}"]').checked&&!document.querySelector('.arxiv-collection-picker input[value="${id}"]').disabled`);
  assert.equal(await evaluate("document.querySelector('#follow-author').textContent==='Following'"),true);
  await click('.collection-picker-heading button');assert.equal(await evaluate("document.activeElement.id==='author-collections'"),true);
  const size=await evaluate('[innerWidth,innerHeight]');await resize(360,600);
  await run("document.querySelector('#name').textContent='Alex Kim with an exceptionally long research display name'");
  assert.equal(await evaluate("(()=>{const a=document.querySelector('#follow-author').getBoundingClientRect(),b=document.querySelector('#author-collections').getBoundingClientRect();return document.documentElement.scrollWidth===document.documentElement.clientWidth&&b.right<=document.documentElement.clientWidth&&(a.right<=b.left||a.bottom<=b.top)})()"),true);
  await screenshot('author-header-narrow.png');await resize(...size);await run("document.querySelector('#name').textContent='Alex Kim'");
  await rpc(`await repository.deleteAuthorCollection(${JSON.stringify(id)});await repository.setOrganizeFollowedAuthorsIntoCollections(${preferences.organizeFollowedAuthorsIntoCollections})`);await run("window.dispatchEvent(new Event('focus'))");
}
