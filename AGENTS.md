# Project guidance

This is a frequently used academic research utility. Secondary information should
be visually restrained, but primary actions such as Follow and Save must remain
immediately recognizable and comfortably clickable.

Keep the interface compact, conventional, desktop-oriented, and typography-led.
Use system UI fonts, normal blue links, restrained colors, subtle borders, and
information-dense rows. Do not add marketing copy, hero layouts, decorative cards,
gradients, gratuitous shadows, or generic SaaS styling.

All persistent operations must cross `PaperRepository` through `RepositoryClient`.
Only `extension/src/lib/storage.js` may access `chrome.storage.local`. Paper and
author collections are separate many-to-many models with separate last-used
settings. Preserve stable IDs, lossless/idempotent migrations, JSON-compatible
records for a future backend, and the documented same-name author limitation.

Run `npm test`, `npm run test:browser`, and `git diff --check` before committing.
