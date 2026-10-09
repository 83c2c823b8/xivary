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

export async function latexAuthorWorkflow({ evaluate, until, reload, resize, screenshot }) {
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
  assert.equal(await evaluate("(()=>{const n=[...document.querySelectorAll('.katex-display')].at(-1);return n.scrollWidth>n.clientWidth && n.querySelector('.katex').getBoundingClientRect().left>=n.getBoundingClientRect().left})()"), true, 'wide equation starts within its scrolling surface');
  await evaluate("document.querySelector('.abstract').scrollIntoView({block:'end'})");
  await screenshot('latex-narrow-bottom.png');
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
  await evaluate(rpc(`repo.putAuthorPaperCache(${JSON.stringify(cache)})`));
  await reload();
  await until(`document.querySelector('.abstract')?.textContent===${JSON.stringify(cache.papers[0].abstract)}`);
  console.log('LATEX WORKFLOW PASS: native KaTeX/MathML/fonts, custom/unknown/malformed/raw math, focus updates, cached filtering, prose and narrow layout');
}
