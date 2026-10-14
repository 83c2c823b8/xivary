import assert from "node:assert/strict";

const definitions = String.raw`\Stab = \operatorname{Stab}
\Hom = \operatorname{Hom}
\Ext = \operatorname{Ext}
\Db = D^{\mathrm{b}}
\Equation = x=y=z`;
const rpc = operation => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repo=new RepositoryClient();return ${operation}})()`;

export async function latexSettingsWorkflow({ evaluate, until, click, reload, resize, screenshot }) {
  await resize(1100, 1000);
  await until("document.querySelector('#render-latex') && !document.querySelector('#render-latex').disabled");
  assert.equal(await evaluate("document.querySelector('#render-latex').checked"), true);
  const draft = async text => evaluate(`(()=>{const input=document.querySelector('#latex-macros');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await draft(definitions);
  await click('#save-macros');
  await until("document.querySelector('#macros-status').textContent==='Macros saved.' && !document.querySelector('#save-macros').disabled");
  await screenshot('latex-settings.png');
  await reload();
  await until(`document.querySelector('#latex-macros')?.value===${JSON.stringify(definitions)}`);
  await draft(String.raw`\Stab = M
\Stab = N`);
  await click('#save-macros');
  await until("document.querySelector('#macros-status').textContent.includes('Line 2: Duplicate')");
  assert.equal(await evaluate(rpc('repo.getPreferences().then(p=>p.customLatexMacros)')), definitions);
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await until("!document.querySelector('#render-latex').disabled");
  assert.equal(await evaluate("document.querySelector('#latex-macros').value"), String.raw`\Stab = M
\Stab = N`, 'focus refresh preserves invalid draft');
  await screenshot('latex-settings-invalid.png');
  await draft(String.raw`\Stab = \operatorname{Stabilizer}`);
  await click('#save-macros');
  await until("document.querySelector('#macros-status').textContent==='Macros saved.' && !document.querySelector('#save-macros').disabled");
  assert.equal(await evaluate(rpc('repo.getPreferences().then(p=>p.customLatexMacros)')), String.raw`\Stab = \operatorname{Stabilizer}`);
  await draft(''); await click('#save-macros');
  await until("document.querySelector('#macros-status').textContent==='Macros saved.' && !document.querySelector('#save-macros').disabled");
  await click('.setting-row:has(#render-latex)');
  await until("!document.querySelector('#render-latex').checked && !document.querySelector('#render-latex').disabled");
  await reload();
  await until("document.querySelector('#render-latex') && !document.querySelector('#render-latex').checked && !document.querySelector('#render-latex').disabled");
  assert.equal(await evaluate("document.querySelector('#latex-macros').value"), '');
  await click('.setting-row:has(#render-latex)');
  await until("document.querySelector('#render-latex').checked && !document.querySelector('#render-latex').disabled");
  await resize(1100, 850);
}

export async function latexAuthorWorkflow({ evaluate, until, reload, resize, screenshot, key }) {
  await resize(1100, 1000);
  // Use the real author cache/repository and normal view load/focus paths, then
  // restore the fixture. No saved paper/follow/collection changes are involved.
  const cache = await evaluate(rpc(`(async()=>{const {stableAuthorKey}=await import('../domain/author.js');return repo.getAuthorPaperCache(stableAuthorKey(document.querySelector('#name').textContent))})()`));
  assert.ok(cache?.papers.length);
  const source = String.raw`We study $M$, $\mathbf{P}$, $d_M(V_I)$ and $\operatorname{mod}\mathbf{P}$, with \(X\subset Y\).

The derived category $\Db$ and stabilizer $\Stab(X)$ use explicit custom commands.
Unknown $\Unknown(X)$ is preserved. The price is \$5; costs $10 and $20 remain prose.

\[\sum_{i=1}^{n} a_i^2 = \frac{n(n+1)(2n+1)}{6}\]
$$a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}=0$$
Malformed $\frac{x}$ stays raw. Ordinary <script>alert(1)</script> is literal text.`;
  const modified = structuredClone(cache);
  modified.papers[0].abstract = source;
  await evaluate(rpc(`repo.putAuthorPaperCache(${JSON.stringify(modified)})`));
  await reload();
  await until("document.querySelectorAll('.abstract .katex').length===7");
  assert.ok((await evaluate("document.querySelector('.abstract').textContent")).includes(String.raw`$\Stab(X)$`));
  assert.equal(await evaluate("document.querySelector('.abstract script, .abstract a, .abstract img')===null"), true);
  await screenshot('latex-unknown.png');
  await evaluate(rpc(`repo.setCustomLatexMacros(${JSON.stringify(definitions)})`));
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await until("document.querySelectorAll('.abstract .katex').length===9");
  assert.equal(await evaluate("document.querySelector('.abstract .katex .katex-mathml math')!==null"), true);
  assert.ok((await evaluate("document.querySelector('.abstract').textContent")).includes(String.raw`$\Unknown(X)$`));
  assert.equal(await evaluate("document.fonts.ready.then(()=>document.fonts.check('16px KaTeX_Main'))"), true);
  await screenshot('latex-math-heavy.png');
  await screenshot('latex-custom-macro.png');
  await evaluate("(()=>{window.__mathNode=document.querySelector('.abstract .katex');document.querySelector('#paper-query').value='';document.querySelector('#paper-query').dispatchEvent(new Event('input'))})()");
  assert.equal(await evaluate("window.__mathNode===document.querySelector('.abstract .katex')"), true, 'filtering reuses rendered math');
  await resize(360, 700);
  assert.equal(await evaluate("document.documentElement.scrollWidth===document.documentElement.clientWidth"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('.katex-display')].every(n=>n.getBoundingClientRect().right<=document.documentElement.clientWidth)"), true);
  await screenshot('latex-narrow.png');
  assert.equal(await evaluate("(()=>{const n=[...document.querySelectorAll('.katex-display')].at(-1),s=getComputedStyle(n);return s.overflowX==='visible'&&s.overflowY==='visible'&&n.scrollWidth<=n.clientWidth+1&&n.getBoundingClientRect().height>40})()"), true, 'wide equation wraps fully without a nested scrolling surface');
  await evaluate("document.querySelector('.abstract').scrollIntoView({block:'end'})");
  await screenshot('latex-narrow-bottom.png');
  // A matrix cannot wrap at operators. Its whole layout must remain reachable
  // on the page, rather than overflowing into the inaccessible left margin.
  const matrix=String.raw`\[\begin{matrix}`+Array.from({length:30},(_,i)=>`a_{${i+1}}`).join('&')+String.raw`\end{matrix}\]`;
  assert.equal(await evaluate(`import('../ui/abstract.js').then(({createAbstractRenderer})=>{
    const n=createAbstractRenderer()(${JSON.stringify(matrix)});document.querySelector('.paper-row').append(n);
    const display=n.querySelector('.katex-display'),math=n.querySelector('.katex-base'),s=getComputedStyle(display);
    const visible=math.getBoundingClientRect().left>=n.getBoundingClientRect().left&&math.getBoundingClientRect().right<=document.scrollingElement.scrollWidth;
    const complete=s.overflowX==='visible'&&s.overflowY==='visible'&&math.getBoundingClientRect().width>n.clientWidth&&visible;
    n.remove();return complete;
  })`),true,'indivisible math is fully reachable using page-level scrolling');
  await resize(1100, 850);
  await evaluate(rpc('repo.setRenderLatexInAbstracts(false)'));
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await until("document.querySelectorAll('.abstract .katex').length===0");
  assert.equal(await evaluate("document.querySelector('.abstract').textContent"), source);
  await screenshot('latex-disabled.png');
  await evaluate(rpc('repo.setRenderLatexInAbstracts(true)'));
  await evaluate(rpc('repo.setCustomLatexMacros("")'));
  const prose = structuredClone(cache);
  prose.papers[0].abstract = 'This abstract contains ordinary prose.\n\nIts paragraph break and  extra spaces are preserved.';
  await evaluate(rpc(`repo.putAuthorPaperCache(${JSON.stringify(prose)})`));
  await reload();
  await until(`document.querySelector('.abstract')?.textContent===${JSON.stringify(prose.papers[0].abstract)}`);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.abstract')).whiteSpace"), 'pre-wrap');
  await screenshot('latex-prose.png');
  const fullGeometry = () => evaluate(`(()=>{
    const n=document.querySelector('.abstract'),s=getComputedStyle(n);
    return {height:n.clientHeight,content:n.scrollHeight,maxHeight:s.maxHeight,overflowX:s.overflowX,overflowY:s.overflowY,
      clamp:s.webkitLineClamp,ellipsis:s.textOverflow,whiteSpace:s.whiteSpace,
      mathVisible:[...n.querySelectorAll('.katex-display')].every(m=>{const style=getComputedStyle(m);return style.overflowX==='visible'&&style.overflowY==='visible'})};
  })()`);
  const checkGeometry = async long => {
    const g=await fullGeometry();
    assert.equal(g.maxHeight,'none');assert.equal(g.overflowX,'visible');assert.equal(g.overflowY,'visible');
    assert.equal(g.clamp,'none');assert.notEqual(g.ellipsis,'ellipsis');assert.equal(g.whiteSpace,'pre-wrap');
    assert.ok(g.content<=g.height+1,JSON.stringify(g));assert.equal(g.mathVisible,true);
    if(long)assert.ok(g.height>1000,'long abstract expands beyond any compact viewport');
  };
  await checkGeometry(false);
  const longSource=Array.from({length:45},(_,i)=>`Paragraph ${i+1}: This complete abstract preserves every sentence,  double spaces and mathematical notation $M_i$ without an internal scroll region.`).join('\n\n')+String.raw`

\[a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}=0\]

FINAL PARAGRAPH: all content remains available.`;
  prose.papers[0].abstract=longSource;
  await evaluate(rpc(`repo.putAuthorPaperCache(${JSON.stringify(prose)})`));await reload();
  await until("document.querySelector('.abstract')?.textContent.endsWith('FINAL PARAGRAPH: all content remains available.')");
  await checkGeometry(true);await screenshot('abstract-full-long.png');
  await resize(360,700);await checkGeometry(true);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
  await evaluate("document.querySelector('.paper-row .actions').scrollIntoView({block:'end'})");
  await screenshot('abstract-full-long-bottom-narrow.png');await resize(1100,850);
  await evaluate(rpc('repo.setRenderLatexInAbstracts(false)'));await evaluate("window.dispatchEvent(new Event('focus'))");
  await until(`document.querySelector('.abstract')?.textContent===${JSON.stringify(longSource)}`);
  await checkGeometry(true);
  if(key) {
    const vim=await evaluate(rpc('repo.getPreferences().then(p=>p.vimMode)'));
    await evaluate(rpc('repo.setVimMode(true)'));
    await evaluate('document.activeElement.blur()');
    await until(`(()=>{const e=new KeyboardEvent('keydown',{key:'g',bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented})()`);
    await key('Escape');
    const offset=await evaluate(`(()=>{const n=document.querySelector('.abstract');n.tabIndex=0;n.focus({preventScroll:true});document.scrollingElement.scrollTo({top:n.offsetTop+100,behavior:'instant'});return scrollY})()`);
    await key('j');await until(`scrollY===${offset+80}`);await key('k');await until(`scrollY===${offset}`);
    assert.equal(await evaluate('document.querySelector(".abstract").scrollTop'),0,'keys scroll the page, never the abstract');
    await key('G');await until('scrollY===document.scrollingElement.scrollHeight-innerHeight');
    await key('g');await key('g');await until('scrollY===0');
    await evaluate('document.activeElement.blur()');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await key('f');await until('document.querySelector("[data-vim-overlay=hints]")');
    assert.equal(await evaluate(`import('../ui/vim-mode.js').then(({hintTargets})=>hintTargets(document,window).includes(document.querySelector('.paper-row h2 a')))`),true);
    await key('Escape');
    await evaluate("document.querySelector('.paper-row .actions a').focus()");await key('Tab');
    assert.equal(await evaluate('document.activeElement.matches(".paper-row .bookmark")'),true,'native focus proceeds from PDF to bookmark');
    assert.equal(await evaluate(`(()=>{const row=document.querySelector('.paper-row');return row.querySelector('h2 a').href===${JSON.stringify(cache.papers[0].absUrl)}&&row.querySelector('.actions a').href===${JSON.stringify(cache.papers[0].pdfUrl)}&&!!document.querySelector('#follow-author')})()`),true);
    await evaluate(rpc(`repo.setVimMode(${JSON.stringify(vim)})`));
  }
  await evaluate(rpc('repo.setRenderLatexInAbstracts(true)'));
  await evaluate(rpc(`repo.putAuthorPaperCache(${JSON.stringify(cache)})`));
  await reload();
  await until(`document.querySelector('.abstract')?.textContent===${JSON.stringify(cache.papers[0].abstract)}`);
  console.log('LATEX WORKFLOW PASS: native KaTeX/MathML/fonts, custom/unknown/malformed/raw math, full short/long/multiparagraph abstracts, no nested scrolling, narrow wrapping'+(key?', native Vim scrolling/hints/focus':''));
}
