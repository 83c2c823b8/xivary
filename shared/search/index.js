// Public, Chrome-independent entry point for Node/web consumers. The single
// implementation lives inside extension/ so Load unpacked needs no copy/build.
export { FIELD_PRESETS } from "../../extension/src/search/field-presets.js";
export { SEARCH_MODES, expandQuery } from "../../extension/src/search/expand-query.js";
export { buildArxivSearchUrl } from "../../extension/src/search/arxiv-search-url.js";
