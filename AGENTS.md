# Project guidance

This is a frequently used academic research utility. Secondary information should
be visually restrained, but primary actions such as Follow and Save must remain
immediately recognizable and comfortably clickable.

Optimize for learned efficiency rather than zero-learning discoverability. A
feature's existence does not justify a permanent button, tab, card, toolbar, or
explanation. Prefer a small predictable interaction model and progressive
disclosure: keep primary actions obvious and reveal infrequent operations only
when needed. Consistency, alignment, and functional density matter more than
visual novelty.

Keep the interface compact, conventional, desktop-oriented, and typography-led.
Use system UI fonts, normal blue links, restrained colors, subtle borders, and
information-dense rows. Do not add marketing copy, hero layouts, decorative cards,
gradients, gratuitous shadows, or generic SaaS styling.

All persistent operations must cross `PaperRepository` through `RepositoryClient`.
Only `extension/src/lib/storage.js` may access `chrome.storage.local`. Paper and
author collections are separate many-to-many models with separate last-used
settings. Preserve stable IDs, lossless/idempotent migrations, JSON-compatible
records for a future backend, and the documented same-name author limitation.
Paper collections are user-facing; author collections remain compatible in
storage but are hidden from the default Follow/Following UI. Search is hidden from
primary navigation. Paper notes are deferred and must not be exposed without a
separate, demonstrated product need.

Run `npm test`, `npm run test:browser`, and `git diff --check` before committing.
