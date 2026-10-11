import assert from 'node:assert/strict';

/** Disposable fixture window; real keys invoke the installed background handler. */
export async function browserTabWorkflow({ evaluateSource, evaluate, send, until, extensionUrl }) {
  const api = "(await import('../platform/browser-api.js')).getBrowserApi()";
  const viaSource = operation => evaluateSource(`(async()=>{const api=${api};return ${operation}})()`);
  const window = await viaSource(`api.windows.create({focused:true,url:${JSON.stringify([
    extensionUrl('library/library.html?vim-tabs=first'), extensionUrl('authors/authors.html?vim-tabs=middle'), extensionUrl('settings/settings.html?vim-tabs=last'),
  ])}})`);
  const sessions = new Map();
  const tabs = () => viaSource(`api.tabs.query({windowId:${window.id}}).then(t=>t.map(({id,index,active,pinned})=>({id,index,active,pinned})))`);
  try {
    for (const tab of window.tabs) {
      const expectedURL=[extensionUrl('library/library.html?vim-tabs=first'),extensionUrl('authors/authors.html?vim-tabs=middle'),extensionUrl('settings/settings.html?vim-tabs=last')][tab.index];
      let target;
      for(let attempt=0;attempt<50&&!target;attempt++) {
        target=(await send('Target.getTargets')).targetInfos.find(target=>target.url===expectedURL);
        if(!target)await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.ok(target, 'fixture tab target');
      const { sessionId } = await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
      sessions.set(tab.id,sessionId);
      await until(sessionId,'Boolean(document.querySelector("#filter:not(:disabled),#vim-mode:not(:disabled)"))');
    }
    await viaSource(`api.tabs.update(${window.tabs[0].id},{pinned:true})`);
    const order = (await tabs()).sort((a,b)=>a.index-b.index).map(tab=>tab.id);
    const activate = async id => { await viaSource(`api.tabs.update(${id},{active:true})`); await send('Page.bringToFront',{},sessions.get(id)); };
    const press = async (id,key) => {
      const sessionId=sessions.get(id);
      await evaluate(sessionId,'document.activeElement.blur()');
      await evaluate(sessionId,'new Promise(resolve=>setTimeout(resolve,120))');
      for(const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),modifiers:/^[A-Z]$/.test(key)?8:0},sessionId);
    };
    const expectActive = async id => {
      for(let attempt=0;attempt<50;attempt++) {
        if((await tabs()).find(tab=>tab.active)?.id===id)return;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.fail(`Expected active tab ${id}: ${JSON.stringify(await tabs())}`);
    };
    for(const [index,key,next] of [[1,'J',0],[0,'K',1],[2,'K',0],[0,'J',2]]) {
      await activate(order[index]);await press(order[index],key);await expectActive(order[next]);
    }
    assert.equal((await tabs())[0].pinned,true,'pinned tabs participate without moving');
    assert.deepEqual((await tabs()).map(tab=>tab.id),order,'keys do not reorder/open/close tabs');
    await activate(order[1]); const middle=sessions.get(order[1]);
    for(const expression of [
      "document.querySelector('#filter').focus();document.querySelector('#filter').dispatchEvent(new KeyboardEvent('keydown',{key:'J',shiftKey:true,bubbles:true,cancelable:true}))",
      "document.activeElement.blur();document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'K',shiftKey:true,bubbles:true,cancelable:true}));document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))",
      "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'J',shiftKey:true,bubbles:true,cancelable:true}))",
    ]) { await evaluate(middle,expression);await new Promise(resolve=>setTimeout(resolve,150));await expectActive(order[1]); }
    await viaSource(`api.runtime.sendMessage({channel:'arxiv-library:repository:v1',method:'setVimMode',args:[false]})`);
    await press(order[1],'J');await expectActive(order[1]);
    await viaSource(`api.runtime.sendMessage({channel:'arxiv-library:repository:v1',method:'setVimMode',args:[true]})`);
    await viaSource(`api.tabs.remove(${JSON.stringify([order[0],order[2]])})`);
    await press(order[1],'J');await expectActive(order[1]);await press(order[1],'K');await expectActive(order[1]);
    assert.equal((await tabs()).length,1,'single-tab window stays intact');
    // A fresh fixture tab has no backward/forward history. These keys cannot
    // fabricate Library/Following navigation even though the nav links exist.
    const initial=await evaluate(middle,'location.href');
    await press(order[1],'h');await press(order[1],'l');assert.equal(await evaluate(middle,'location.href'),initial);
    console.log('BROWSER TABS PASS: native J/K, same window, wraparound, pinned/single tabs, editing/IME/hint/disabled guards; no new permissions');
  } finally { await viaSource(`api.windows.remove(${window.id})`); }
}
