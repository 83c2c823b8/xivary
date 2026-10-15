import test from 'node:test';
import assert from 'node:assert/strict';
import { bindReorder } from '../extension/src/ui/reorder.js';

function fixture(operation) {
  const prior={document:globalThis.document,window:globalThis.window,innerHeight:globalThis.innerHeight};
  const listeners=new Map(),moves=[];
  function node() {
    const events=new Map(),classes=new Set(),captured=new Set();
    return {children:[],dataset:{},style:{},className:'',classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value)},
      setAttribute(){},prepend(child){this.children.unshift(child);},querySelector(){return this.children.find(child=>child.className==='reorder-handle');},
      addEventListener:(name,fn)=>events.set(name,fn),dispatch:(name,event)=>events.get(name)?.({button:0,pointerId:1,preventDefault(){},stopPropagation(){},...event}),
      setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),
      focus(){},closest(){return this;},getBoundingClientRect(){return {left:0,right:300,top:0,bottom:160,height:160};}};
  }
  globalThis.document={createElement:node};globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),scrollBy(){}};globalThis.innerHeight=1000;
  const list=node();
  list.children=['','a','b','c'].map((id,index)=>{const row=node();if(id)row.dataset.reorderId=id;row.getBoundingClientRect=()=>({left:0,right:300,top:index*40,bottom:(index+1)*40,height:40});return row;});
  const controller=bindReorder(list,{move:(...args)=>moves.push(args)});
  for(const row of list.children.filter(row=>row.dataset.reorderId))controller.attach(row,row.dataset.reorderId,row.dataset.reorderId.toUpperCase());
  try { operation({list,moves,controller,listeners}); } finally {Object.assign(globalThis,prior);}
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
