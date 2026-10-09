import katex from "../../vendor/katex/katex.mjs";
import { assertSafeMath, mathOptions, parseLatexMacros, scanAbstract } from "../domain/latex.js";

/** A renderer belongs to one view/configuration; no global mutable macro state. */
export function createAbstractRenderer(settings = {}) {
  let macros;
  try { macros = parseLatexMacros(settings.customLatexMacros ?? ""); }
  catch { macros = {}; } // Damaged/unsupported local configuration never hides text.
  return (source, document = globalThis.document) => {
    const node = document.createElement("p");
    node.className = "abstract";
    if (settings.renderLatexInAbstracts === false) { node.textContent = source; return node; }
    for (const part of scanAbstract(source)) {
      if (part.text !== undefined) { node.append(document.createTextNode(part.text)); continue; }
      const math = document.createElement("span");
      try {
        assertSafeMath(part.math);
        katex.render(part.math, math, { ...mathOptions, displayMode: part.displayMode, macros: { ...macros } });
        node.append(math);
      } catch { node.append(document.createTextNode(part.source)); }
    }
    return node;
  };
}
