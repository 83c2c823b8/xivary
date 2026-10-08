import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerPosition, pointerPosition } from '../extension/src/ui/popover-position.js';
const base = {anchor:{left:40,right:74,top:80,bottom:114},width:300,height:240,viewportWidth:1000,viewportHeight:800};
test('picker prefers below/left and aligns right-side triggers to the right',()=>{
 assert.deepEqual(pickerPosition(base),{left:40,top:121,maxHeight:240,side:'below'});
 assert.equal(pickerPosition({...base,anchor:{...base.anchor,left:940,right:974}}).left,674);
});
test('picker flips above and chooses/constrains the larger available side',()=>{
 assert.deepEqual(pickerPosition({...base,anchor:{...base.anchor,top:700,bottom:734}}),{left:40,top:453,maxHeight:240,side:'above'});
 assert.deepEqual(pickerPosition({...base,height:360,viewportHeight:400,anchor:{...base.anchor,top:170,bottom:204}}),{left:40,top:211,maxHeight:181,side:'below'});
});
test('narrow viewport, edge collisions and changed content dimensions stay bounded',()=>{
 const pos=pickerPosition({...base,width:284,height:360,viewportWidth:300,viewportHeight:500,anchor:{left:266,right:300,top:280,bottom:314}});
 assert.equal(pos.left,8);assert.equal(pos.side,'above');assert.equal(pos.maxHeight,265);assert.equal(pos.top,8);
 assert.equal(pickerPosition({...base,height:600,anchor:{...base.anchor,top:600,bottom:634}}).side,'above');
 for(const [x,y] of [[-10,-10],[995,795],[10,795]]){
  const p=pointerPosition({x,y,width:196,height:90,viewportWidth:1000,viewportHeight:800});
  assert.ok(p.left>=8&&p.left+196<=992&&p.top>=8&&p.top+90<=792);
 }
});
