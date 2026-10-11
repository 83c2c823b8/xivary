import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSection } from '../extension/src/ui/settings-toc.js';

test('Settings scroll-spy follows document headings and selects the final section at the bottom', () => {
  assert.equal(currentSection([],16),-1);
  assert.equal(currentSection([100,300,600],16),0);
  assert.equal(currentSection([-200,8,350],16),1);
  assert.equal(currentSection([-200,-100,80],90),2,'narrow sticky navigation offset');
  assert.equal(currentSection([-200,20,250],16,true),2,'last short section is reachable');
});
