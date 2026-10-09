import test from "node:test";
import assert from "node:assert/strict";
import { parseLatexMacros, scanAbstract } from "../extension/src/domain/latex.js";
import { createAbstractRenderer } from "../extension/src/ui/abstract.js";
import { LocalRepository } from "../extension/src/repository/local-repository.js";
import { RepositoryClient } from "../extension/src/repository/repository-client.js";
import { createRepositoryHandler } from "../extension/src/background/repository-handler.js";

// Minimal DOM sink for KaTeX's real render API. Browser suites separately verify
// native DOM, font loading, geometry and accessibility markup.
class Node {
  constructor(tag, text = "") { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.text = text; }
  set textContent(text) { this.children = []; this.text = text; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  setAttribute(key, value) { this.attributes[key] = value; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
}
const document = { compatMode: "CSS1Compat", createElement: tag => new Node(tag),
  createElementNS: (_, tag) => new Node(tag), createTextNode: text => new Node("#text", text), createDocumentFragment: () => new Node("#fragment") };
function render(source, settings) {
  globalThis.document = document;
  try { return createAbstractRenderer(settings)(source, document); }
  finally { delete globalThis.document; }
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function expressions(node) { return descendants(node).filter(node => node.tag === "annotation").map(node => node.textContent); }

test("common inline/display delimiters render through KaTeX with MathML and exact prose", () => {
  for (const math of ["M", String.raw`\mathbf{P}`, "d_M(V_I)", String.raw`\operatorname{mod}\mathbf{P}`]) {
    const source = `Before $${math}$ after.`;
    const node = render(source);
    assert.deepEqual(expressions(node), [math]);
    assert.equal(node.children[0].textContent, "Before ");
    assert.equal(node.children.at(-1).textContent, " after.");
  }
  const source = String.raw`Prose $M$ and \(N\).

Display $$x^2$$ and \[y^2\].`;
  assert.deepEqual(expressions(render(source)), ["M", "N", "x^2", "y^2"]);
  assert.equal(scanAbstract(source).map(part => part.text ?? part.source).join(""), source);
  assert.equal(render("Ordinary text\n\nwith  whitespace.").textContent, "Ordinary text\n\nwith  whitespace.");
});

test("invalid, untrusted and ambiguous expressions preserve raw source independently", () => {
  for (const source of [String.raw`Unknown $\Stab(X)$`, String.raw`Bad $\frac{a}$`,
    String.raw`$\href{javascript:alert(1)}{x}$`, String.raw`$\htmlClass{evil}{x}$`,
    "Unmatched $M", String.raw`Unmatched \(M`, String.raw`Escaped \$M\$`,
    "Costs $5 and $10. Save $20 today.", "Prices US$50, $2.50 and $100", "$ M $", "<script>alert(1)</script>"]) {
    const node = render(source);
    assert.deepEqual(expressions(node), [], source);
    assert.equal(node.textContent, source);
    assert.equal(descendants(node).some(node => node.tag === "script" || node.tag === "a" || node.tag === "img"), false);
  }
  const source = String.raw`$M$ then $\Unknown(X)$ then $N$`;
  const node = render(source);
  assert.deepEqual(expressions(node), ["M", "N"]);
  assert.ok(node.textContent.includes(String.raw`$\Unknown(X)$`));
  assert.deepEqual(expressions(render(String.raw`\(unmatched then $M$`)), ["M"]);
  const long = "Prose ".repeat(20000) + "$M$";
  assert.deepEqual(expressions(render(long)), ["M"]);
  const giant = "$" + "x".repeat(5000) + "$";
  assert.equal(render(giant).textContent, giant);
});

test("macro lines split at first equals and validate all zero-argument expansions", () => {
  const text = String.raw`\Stab = \operatorname{Stab}
\Hom = \operatorname{Hom}
\Ext = \operatorname{Ext}
\Db = D^{\mathrm{b}}
\Equation = x=y=z`;
  const macros = parseLatexMacros(text);
  assert.equal(macros["\\Equation"], "x=y=z");
  assert.equal(macros["\\Stab"], String.raw`\operatorname{Stab}`);
  const node = render(String.raw`$\Stab(X)$ $\Db$`, { customLatexMacros: text });
  assert.deepEqual(expressions(node), [String.raw`\Stab(X)`, String.raw`\Db`]);
  assert.equal(descendants(node).some(node => node.textContent === "Stab"), true);
  assert.deepEqual(expressions(render(String.raw`$\Stab(X)$`)), []);
  assert.deepEqual(expressions(render(String.raw`$\Stab(X)$`, { customLatexMacros: "" })), []);
  assert.deepEqual(expressions(render(String.raw`$\Alias$`, { customLatexMacros: String.raw`\Alias = \Later
\Later = M` })), [String.raw`\Alias`]);
});

test("invalid macros give actionable line errors without overriding commands", () => {
  for (const [text, error] of [
    [String.raw`\Stab = M
\Stab = N`, /Line 2: Duplicate/],
    [String.raw`Stab = M`, /Line 1: Command names/],
    [String.raw`\foo2 = M`, /only letters/],
    [String.raw`\frac = M`, /reserved/], [String.raw`\alpha = M`, /reserved/],
    [String.raw`\sin = M`, /reserved/], [String.raw`\newcommand = M`, /reserved/],
    [String.raw`\textdagger = M`, /reserved/],
    [String.raw`\Foo = \Unknown`, /Invalid replacement/],
    [String.raw`\Foo = \frac{a}`, /Invalid replacement/],
    [String.raw`\Foo = #1`, /zero-argument/], [String.raw`\Foo =`, /Enter a replacement/],
    [String.raw`\Foo = \Foo`, /Too many expansions/],
    [String.raw`\Foo = \href{javascript:alert(1)}{x}`, /not supported/],
    [String.raw`\Foo = \htmlStyle{color:red}{x}`, /not supported/],
    [String.raw`\Foo = \gdef\Evil{x}`, /not supported/],
    [String.raw`\Foo = \DeclareMathOperator{\Evil}{x}`, /not supported/],
  ]) assert.throws(() => parseLatexMacros(text), error);
  assert.deepEqual(expressions(render(String.raw`$\gdef\Leak{M}$ $\Leak$`)), []);
});

test("off returns exact raw notation; no HTML can be inserted through abstracts/macros", () => {
  const source = String.raw`<img src=x onerror=alert(1)> $M$ \(N\)`;
  assert.equal(render(source, { renderLatexInAbstracts: false }).textContent, source);
  const node = render(String.raw`$\Markup$`, { customLatexMacros: String.raw`\Markup = \text{<script>alert(1)</script>}` });
  assert.deepEqual(expressions(node), [String.raw`\Markup`]);
  assert.equal(descendants(node).some(node => node.tag === "script"), false);
});

test("local settings default safely, persist through RPC/restart, and isolate invalid drafts/portable data", async () => {
  let disk;
  let writes = 0;
  const storage = { read: async () => structuredClone(disk), write: async value => { disk = structuredClone(value); writes++; } };
  const repository = new LocalRepository(storage);
  const handler = createRepositoryHandler(repository, "test");
  const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => handler(message, { id: "test" }, resolve)) });
  assert.equal((await client.getPreferences()).renderLatexInAbstracts, true);
  await repository.savePaper({ arxivId: "2401.00001", title: "Raw $M$", authors: ["Alex Kim"], abstract: "$M$" });
  await repository.followAuthor({ displayName: "Alex Kim" });
  delete disk.settings.renderLatexInAbstracts;
  delete disk.settings.customLatexMacros;
  const before = structuredClone(disk);
  assert.equal((await client.getPreferences()).renderLatexInAbstracts, true);
  assert.deepEqual(disk, before, "reading defaults does not replace existing data");
  await client.setRenderLatexInAbstracts(false);
  await client.setCustomLatexMacros(String.raw`\Stab = \operatorname{Stab}`);
  let restarted = new LocalRepository(storage);
  assert.equal((await restarted.getPreferences()).renderLatexInAbstracts, false);
  assert.equal((await restarted.getPreferences()).customLatexMacros, String.raw`\Stab = \operatorname{Stab}`);
  const saved = structuredClone(disk), count = writes;
  await assert.rejects(client.setCustomLatexMacros(String.raw`\Stab = \Unknown`), /Invalid replacement/);
  await assert.rejects(client.setRenderLatexInAbstracts("yes"), /true or false/);
  assert.deepEqual(disk, saved);
  assert.equal(writes, count);
  for (const key of ["favorites", "authors", "paperCollections", "collections", "paperMemberships", "memberships"]) assert.deepEqual(disk[key], before[key]);
  for (const category of ["bookmarks", "following"]) {
    const backup = await restarted.exportCategory(category, { kind: "all" });
    assert.equal(JSON.stringify(backup).includes("customLatexMacros"), false);
    await restarted.importCategory(JSON.stringify(backup), category);
    assert.deepEqual(await restarted.getPreferences(), await repository.getPreferences());
  }
  await client.setCustomLatexMacros(String.raw`\Stab = N`);
  assert.equal((await restarted.getPreferences()).customLatexMacros, String.raw`\Stab = N`);
  await client.setCustomLatexMacros("");
  assert.equal((await new LocalRepository(storage).getPreferences()).customLatexMacros, "");
});
