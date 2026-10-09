import katex from "../../vendor/katex/katex.mjs";

export const MAX_MATH_LENGTH = 4096;
export const mathOptions = {
  trust: false, throwOnError: true, strict: "error", output: "htmlAndMathml",
  maxExpand: 200, maxSize: 10,
};

// Restrict definitions to ordinary zero-argument expansions. Unsupported active
// operations fall back in abstracts too; this is a policy check, not a TeX parser.
const restricted = new Set([
  "href", "url", "includegraphics", "htmlClass", "htmlId", "htmlStyle", "htmlData",
  "def", "gdef", "edef", "xdef", "let", "futurelet", "newcommand", "renewcommand",
  "providecommand", "global", "csname", "endcsname", "expandafter", "noexpand",
  "DeclareMathOperator", "newenvironment", "renewenvironment",
]);
export function assertSafeMath(source) {
  if (source.length > MAX_MATH_LENGTH) throw new Error("Expression exceeds 4096 characters.");
  for (const match of source.matchAll(/\\([a-zA-Z]+|.)/gu)) {
    if (restricted.has(match[1])) throw new Error(`Command \\${match[1]} is not supported in abstracts.`);
  }
}

function isUnknownCommand(name) {
  // Probe both supported contexts: some built-in symbols exist only in text mode.
  // Any success or any error other than this exact undefined name reserves it.
  return [name, `\\text{${name}}`].every(source => {
    try { katex.renderToString(source, mathOptions); return false; }
    catch (error) { return error instanceof katex.ParseError && error.rawMessage === `Undefined control sequence: ${name}`; }
  });
}

/** Parse all lines before validating expansions, so forward references work. */
export function parseLatexMacros(text) {
  if (typeof text !== "string" || text.length > 16384) throw new Error("Use at most 16384 characters of macro definitions.");
  const macros = Object.create(null);
  const definitions = [];
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const fail = message => { throw new Error(`Line ${index + 1}: ${message}`); };
    const separator = line.indexOf("=");
    if (separator < 0) fail("Use \\Command = replacement.");
    const name = line.slice(0, separator).trim();
    const replacement = line.slice(separator + 1).trim();
    if (!/^\\[A-Za-z]+$/u.test(name)) fail("Command names must start with a backslash and contain only letters.");
    if (Object.hasOwn(macros, name)) fail(`Duplicate definition for ${name}; keep one definition.`);
    if (!isUnknownCommand(name)) fail(`${name} is reserved by KaTeX; choose a different name.`);
    if (!replacement) fail("Enter a replacement, or remove the definition line.");
    if (/[#%]/u.test(replacement)) fail("Only zero-argument macros are supported; parameters and comments are unavailable.");
    try { assertSafeMath(replacement); } catch (error) { fail(error.message); }
    macros[name] = replacement;
    definitions.push({ name, index, fail });
    if (definitions.length > 100) fail("Use at most 100 macros.");
  }
  for (const { name, fail } of definitions) {
    try { katex.renderToString(name, { ...mathOptions, macros: { ...macros } }); }
    catch (error) { fail(`Invalid replacement for ${name}: ${error.rawMessage || error.message}`); }
  }
  return macros;
}

const delimiters = [["$$", "$$", true], ["\\[", "\\]", true], ["\\(", "\\)", false], ["$", "$", false]];

/** Conservative bounded delimiter scanner. Text pieces always reconstruct the
 * exact source. KaTeX alone interprets expression syntax. No global replacement.
 */
export function scanAbstract(source) {
  const parts = [];
  let plainStart = 0;
  let budget = source.length * 4;
  for (let i = 0; i < source.length;) {
    const delimiter = delimiters.find(([open]) => source.startsWith(open, i));
    if (!delimiter) { i += source[i] === "\\" ? 2 : 1; continue; }
    const [open, close, displayMode] = delimiter;
    const start = i + open.length;
    // Single dollars bordering whitespace or numbers are especially ambiguous.
    if (open === "$" && (/\s|\d/u.test(source[start] || " ") || /\d/u.test(source[i - 1] || ""))) { i = start; continue; }
    let end = -1, depth = 0;
    for (let j = start; j - start <= MAX_MATH_LENGTH && j < source.length && budget-- > 0; j++) {
      if (source.startsWith(close, j) && depth === 0) { end = j; break; }
      if (source[j] === "\n" && (open === "$" || source[j + 1] === "\n")) break;
      if (source[j] === "\\") { j++; continue; }
      if (source[j] === "{") depth++;
      if (source[j] === "}") depth--;
    }
    if (end < 0 || end === start || (open === "$" && (/\s/u.test(source[end - 1]) || source[end + 1] === "$" || /\d/u.test(source[end + 1] || "")))) { i = start; continue; }
    if (plainStart < i) parts.push({ text: source.slice(plainStart, i) });
    parts.push({ source: source.slice(i, end + close.length), math: source.slice(start, end), displayMode });
    i = end + close.length;
    plainStart = i;
  }
  if (plainStart < source.length) parts.push({ text: source.slice(plainStart) });
  return parts;
}
