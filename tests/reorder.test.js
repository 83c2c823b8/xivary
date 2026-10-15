import test from 'node:test';
import assert from 'node:assert/strict';
import { bindReorder } from '../extension/src/ui/reorder.js';

async function fixture(operation, moveOperation) {
  const prior={document:globalThis.document,window:globalThis.window,innerHeight:globalThis.innerHeight};
  const listeners=new Map(),moves=[];
  function node() {
    const events=new Map(),classes=new Set(),captured=new Set();
    return {children:[],dataset:{},style:{},className:'',classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value)},
      setAttribute(name,value){this[name]=value;},prepend(child){child.parentElement=this;this.children.unshift(child);},querySelector(){return this.children.find(child=>child.className==='reorder-handle');},
      remove(){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
      addEventListener:(name,fn)=>events.set(name,fn),dispatch:(name,event)=>events.get(name)?.({button:0,pointerId:1,preventDefault(){},stopPropagation(){},...event}),
      setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),
      focus(){document.activeElement=this;listeners.get('focusin')?.({target:this});},blur(){if(document.activeElement===this)document.activeElement=document.body;},closest(){return this;},getBoundingClientRect(){return {left:0,right:300,top:0,bottom:160,height:160};}};
  }
  globalThis.document={createElement:node,body:node()};document.activeElement=document.body;globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),scrollBy(){}};globalThis.innerHeight=1000;
  const list=node();
  list.children=['','a','b','c'].map((id,index)=>{const row=node();if(id)row.dataset.reorderId=id;row.getBoundingClientRect=()=>({left:0,right:300,top:index*40,bottom:(index+1)*40,height:40});return row;});
  const controller=bindReorder(list,{move:(...args)=>{moves.push(args);return moveOperation?.(...args);}});
  for(const row of list.children.filter(row=>row.dataset.reorderId))controller.attach(row,row.dataset.reorderId,row.dataset.reorderId.toUpperCase());
  try { await operation({list,moves,controller,listeners,node}); } finally {Object.assign(globalThis,prior);}
}
test('keyboard handles move up/down/Home/End among real IDs only, without touching fixed aggregate',()=>fixture(({list,moves})=>{
  const a=list.children[1].children[0],c=list.children[3].children[0];
  a.dispatch('keydown',{key:'ArrowDown'});c.dispatch('keydown',{key:'ArrowUp'});c.dispatch('keydown',{key:'Home'});a.dispatch('keydown',{key:'End'});
  assert.deepEqual(moves,[['a','c','A'],['c','b','C'],['c','a','C'],['a',null,'A']]);
  assert.equal(list.children[0].children.length,0);
  a.dispatch('keydown',{key:'ArrowUp'});c.dispatch('keydown',{key:'End'});assert.equal(moves.length,4);
}));
test('drag requires a handle and movement threshold, displays a drop position and commits only on drop',()=>fixture(({list,moves,controller})=>{
  const handle=list.children[1].children[0];
  handle.dispatch('pointerdown',{clientX:10,clientY:50});handle.dispatch('pointermove',{clientX:10,clientY:150});
  assert.equal(controller.dragging,true);assert.equal(list.children[3].classList.contains('drop-after'),true);assert.equal(moves.length,0);
  handle.dispatch('pointerup',{clientX:10,clientY:150});assert.deepEqual(moves,[['a',null,'A']]);assert.equal(controller.dragging,false);
  assert.equal(list.children[3].classList.contains('drop-after'),false);
  assert.equal(list.children[1].draggable,undefined);
}));
test('Escape, pointer cancellation, outside drop and click-only gestures do not commit',()=>fixture(({list,moves,controller,listeners})=>{
  const handle=list.children[1].children[0];
  for(const kind of ['escape','cancel','outside','click']){
    handle.dispatch('pointerdown',{clientX:10,clientY:50});if(kind!=='click')handle.dispatch('pointermove',{clientX:10,clientY:150});
    if(kind==='escape')listeners.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
    else if(kind==='cancel')handle.dispatch('pointercancel',{});
    else handle.dispatch('pointerup',{clientX:kind==='outside'?1000:10,clientY:kind==='outside'?1000:50});
    assert.equal(controller.dragging,false);
  }
  assert.deepEqual(moves,[]);
}));
test('aggregate and below-list drop regions are excluded, with no lingering indicator',()=>fixture(({list,moves,controller})=>{
  const handle=list.children[2].children[0];
  for(const y of [20,180]) {
    handle.dispatch('pointerdown',{clientX:10,clientY:90});handle.dispatch('pointermove',{clientX:10,clientY:y});
    assert.ok(list.children.every(row=>!row.classList.contains('drop-before')&&!row.classList.contains('drop-after')));
    handle.dispatch('pointerup',{clientX:10,clientY:y});assert.equal(controller.dragging,false);
  }
  assert.deepEqual(moves,[]);
}));
test('filtered unavailable handles reject pointer/keyboard movement; detaching cancels active dragging',()=>fixture(({list,moves,controller})=>{
  const row=list.children[1],handle=controller.attach(row,'a','A',{disabled:true,disabledReason:'Clear filters.'});
  assert.equal(handle.disabled,true);assert.equal(handle.title,'Clear filters.');
  handle.dispatch('keydown',{key:'End'});handle.dispatch('pointerdown',{clientX:10,clientY:50});
  assert.equal(controller.dragging,false);assert.deepEqual(moves,[]);
  controller.attach(row,'a','A');assert.equal(handle.disabled,false);
  handle.dispatch('pointerdown',{clientX:10,clientY:50});handle.dispatch('pointermove',{clientX:10,clientY:150});
  controller.detach(row);assert.equal(controller.dragging,false);assert.equal(row.children.length,0);
  assert.equal(row.dataset.reorderId,undefined);assert.equal(row.classList.contains('reorderable'),false);assert.deepEqual(moves,[]);
}));

test('pointer completion and every cancellation release only the dragged handle focus',()=>fixture(({list,moves,controller,listeners,node})=>{
  const handle=list.children[1].children[0],other=node();
  for(const end of ['drop','escape','pointercancel','capture','blur','explicit','outside']){
    handle.focus();handle.dispatch('pointerdown',{clientX:10,clientY:50});handle.dispatch('pointermove',{clientX:10,clientY:150});
    if(end==='escape')listeners.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
    else if(end==='pointercancel')handle.dispatch('pointercancel',{});
    else if(end==='capture')handle.dispatch('lostpointercapture',{});
    else if(end==='blur')listeners.get('blur')({});
    else if(end==='explicit')controller.cancel();
    else handle.dispatch('pointerup',{clientX:end==='outside'?1000:10,clientY:150});
    assert.equal(document.activeElement,document.body);assert.equal(controller.dragging,false);
    assert.ok(list.children.every(row=>!row.classList.contains('reorder-dragging')&&!row.classList.contains('drop-before')&&!row.classList.contains('drop-after')));
  }
  assert.equal(moves.length,1);
  handle.dispatch('pointerdown',{clientX:10,clientY:50});handle.dispatch('pointermove',{clientX:10,clientY:150});other.focus();controller.cancel();
  assert.equal(document.activeElement,other,'cancellation never blurs another control');
}));
test('a pointer click keeps native focus; reused handles refresh their labels and keyboard metadata',()=>fixture(({list,controller,moves})=>{
  const row=list.children[1],handle=row.children[0];handle.focus();
  handle.dispatch('pointerdown',{clientX:10,clientY:50});handle.dispatch('pointerup',{clientX:10,clientY:50});
  assert.equal(document.activeElement,handle);assert.equal(moves.length,0);
  assert.equal(controller.attach(row,'a','Renamed author'),handle);assert.equal(handle['aria-label'],'Move Renamed author');
  handle.dispatch('keydown',{key:'End'});assert.deepEqual(moves,[['a',null,'Renamed author']]);
}));
test('keyboard focus survives an asynchronous save and replacement row, without restoring pointer focus',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  await fixture(async({list,controller})=>{
    const handle=list.children[1].children[0];handle.focus();handle.dispatch('keydown',{key:'End'});
    handle.blur();controller.detach(list.children[1]);list.children[1].dataset.reorderId='a';const replacement=controller.attach(list.children[1],'a','A');
    finish();await pending;await Promise.resolve();
    assert.equal(document.activeElement,replacement,'keyboard save restores the replacement handle');
    replacement.dispatch('pointerdown',{clientX:10,clientY:50});replacement.dispatch('pointermove',{clientX:10,clientY:150});replacement.dispatch('pointerup',{clientX:10,clientY:150});
    await Promise.resolve();assert.equal(document.activeElement,document.body,'pointer save never refocuses after I/O');
  },()=>pending);
});
test('asynchronous keyboard completion never steals focus from another control',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  await fixture(async({list,node})=>{
    const handle=list.children[1].children[0],other=node();handle.focus();handle.dispatch('keydown',{key:'End'});handle.blur();other.focus();
    finish();await pending;await Promise.resolve();assert.equal(document.activeElement,other);
  },()=>pending);
});

test('cancellation before the movement threshold releases pointer focus without changing order',()=>fixture(({list,controller,moves})=>{
  const handle=list.children[1].children[0];handle.focus();handle.dispatch('pointerdown',{clientX:10,clientY:50});handle.dispatch('pointercancel',{});
  assert.equal(document.activeElement,document.body);assert.equal(controller.dragging,false);assert.deepEqual(moves,[]);
}));
