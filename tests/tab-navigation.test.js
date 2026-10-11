import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentTab, createTabNavigationHandler } from '../extension/src/background/tab-navigation.js';
import { activateAdjacentTab, TAB_NAVIGATION_CHANNEL } from '../extension/src/platform/tab-navigation.js';

test('adjacent tabs use index order, wrap both ends and include pinned tabs', () => {
  const tabs = [{ id: 3, index: 2 }, { id: 1, index: 0, pinned: true }, { id: 2, index: 1 }];
  for (const [source, direction, expected] of [[1,1,2],[2,-1,1],[3,1,1],[1,-1,3]]) assert.equal(adjacentTab(tabs,source,direction).id,expected);
  assert.equal(adjacentTab([tabs[0]],3,1),null); assert.equal(adjacentTab(tabs,9,1),null);
  assert.deepEqual(tabs.map(tab => tab.id),[3,1,2], 'never reorder source records');
});

test('background activation validates source, live mode and window, and handles closed tabs/API errors', async () => {
  const url = 'chrome-extension://fixture/src/library/library.html';
  let enabled = true, active = true, updates = [], failure = '', queried;
  const source = { id: 2, index: 1, windowId: 7, url, get active() { return active; } };
  const api = { runtime: { id: 'fixture', getURL: path => `chrome-extension://fixture/${path}` }, tabs: {
    get: async () => { if(failure === 'get') throw Error('Closed'); return source; },
    query: async query => { queried = query; if(failure === 'query') throw Error('Unavailable'); return [{id:1,index:0,pinned:true},source,{id:3,index:2}]; },
    update: async (id, options) => { if(failure === 'update') throw Error('Closed'); updates.push({id,options}); },
  } };
  const handler = createTabNavigationHandler(api, { getPreferences: async () => ({vimMode:enabled}) });
  const send = (direction, change = {}, senderChange = {}) => new Promise(resolve => handler({ channel:TAB_NAVIGATION_CHANNEL,sourceTabId:2,direction,...change },{id:'fixture',url,...senderChange},resolve));
  assert.equal((await send(1)).result,true); assert.equal((await send(-1)).result,true);
  assert.deepEqual(queried,{windowId:7}); assert.deepEqual(updates,[{id:3,options:{active:true}},{id:1,options:{active:true}}]);
  updates = []; enabled = false; assert.equal((await send(1)).result,false); enabled = true;
  active = false; assert.equal((await send(1)).result,false); active = true;
  for (failure of ['get','query','update']) assert.equal((await send(1)).ok,false);
  failure = ''; assert.equal((await send(0)).ok,false);
  assert.equal((await send(1,{}, {id:'external'})).ok,false);
  assert.equal((await send(1,{}, {url:'https://arxiv.org/abs/2401.00001'})).ok,false);
  assert.equal((await send(1,{}, {url:url+'.evil'})).ok,false);
  assert.equal((await send(1,{}, {tab:{id:9}})).result,false);
  assert.deepEqual(updates,[]);
  assert.equal(handler({channel:'other'}, {}, () => assert.fail()),false);
});

test('platform identifies its own source tab and reports missing/failed replies honestly', async () => {
  let message, source = {id:42}, reply = {ok:true,result:true};
  const api = { tabs:{getCurrent:async()=>source}, runtime:{sendMessage:async value=>{message=value;return reply;}} };
  assert.equal(await activateAdjacentTab(-1,api),true);
  assert.deepEqual(message,{channel:TAB_NAVIGATION_CHANNEL,sourceTabId:42,direction:-1});
  reply = {ok:false}; assert.equal(await activateAdjacentTab(1,api),false);
  source = undefined; assert.equal(await activateAdjacentTab(1,api),false);
});
