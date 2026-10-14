import assert from 'node:assert/strict';

/** Installed page/layout with a temporary long-page spacer and native keys. */
export async function edgeScrollWorkflow({ evaluate, until, key, media }) {
  const page = await evaluate('location.pathname');
  await evaluate(`(()=>{
    document.activeElement.blur();
    const spacer=document.createElement('div');spacer.id='vim-edge-spacer';spacer.style.height='200000px';
    document.querySelector('main').append(spacer);document.scrollingElement.scrollTo({top:0,behavior:'instant'});
  })()`);
  // The Settings checkbox and Vim listener receive live preferences separately.
  // Wait for the controller itself, then clear the readiness probe's g sequence.
  await until(`(()=>{const event=new KeyboardEvent('keydown',{key:'g',bubbles:true,cancelable:true});document.body.dispatchEvent(event);return event.defaultPrevented})()`);
  await key('Escape');
  const startTrace = () => evaluate(`(()=>{
    window.vimEdgeTrace=[];
    const sample=()=>{window.vimEdgeTrace.push(document.scrollingElement.scrollTop);window.vimEdgeFrame=requestAnimationFrame(sample)};
    window.vimEdgeFrame=requestAnimationFrame(sample);
  })()`);
  const stopTrace = () => evaluate('(()=>{cancelAnimationFrame(window.vimEdgeFrame);return window.vimEdgeTrace})()');
  try {
    const bottom = await evaluate('document.scrollingElement.scrollHeight-innerHeight');
    await startTrace(); await key('G'); await key('G');
    await until(`Math.abs(document.scrollingElement.scrollTop-${bottom})<=1`);
    let trace = await stopTrace();
    assert.ok(trace.some(y => y > 0 && y < bottom), `${page}: G has intermediate frames`);
    assert.ok(trace.every((y, i) => !i || y >= trace[i-1]), `${page}: no competing animation`);
    await startTrace(); await key('g'); await key('g');
    await until('document.scrollingElement.scrollTop===0'); trace = await stopTrace();
    assert.ok(trace.some(y => y > 0 && y < bottom), `${page}: gg has intermediate frames`);
    assert.ok(trace.every((y, i) => !i || y <= trace[i-1]));
    // DOM-dispatched interruption is a controlled fixture on the installed page.
    const stopped = await evaluate(`new Promise(resolve=>{
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'G',bubbles:true,cancelable:true}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        document.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:1}));resolve(document.scrollingElement.scrollTop);
      }));
    })`);
    assert.ok(stopped > 0 && stopped < bottom);
    await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
    assert.equal(await evaluate('document.scrollingElement.scrollTop'), stopped, `${page}: wheel cancels`);
    await key('G'); await key('Escape');
    const escaped = await evaluate('document.scrollingElement.scrollTop');
    await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
    assert.equal(await evaluate('document.scrollingElement.scrollTop'), escaped, `${page}: native Escape cancels`);
    if (media) {
      await media({ reducedMotion: true });
      await until('matchMedia("(prefers-reduced-motion: reduce)").matches');
      await key('G'); assert.equal(await evaluate('document.scrollingElement.scrollTop'), bottom);
      await key('g'); await key('g'); assert.equal(await evaluate('document.scrollingElement.scrollTop'), 0);
      await media({ reducedMotion: false });
    }
  } finally {
    await evaluate(`(()=>{
      cancelAnimationFrame(window.vimEdgeFrame);delete window.vimEdgeFrame;delete window.vimEdgeTrace;
      document.querySelector('#vim-edge-spacer')?.remove();document.scrollingElement.scrollTo({top:0,behavior:'instant'});
    })()`);
    // Removing the spacer changes document geometry and emits native scroll
    // events. Let those finish before the caller starts a new hint session.
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  console.log(`EDGE SCROLL PASS: ${page}, animated gg/G, repeated G, wheel/Escape interruption${media?', reduced motion':''}`);
}
