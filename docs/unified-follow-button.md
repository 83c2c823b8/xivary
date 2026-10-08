# Unified Follow button — 2026-10-09

Started clean on `master` at `5ac82eb6426de91b0f0ab71cf07148b78cc58015`,
one commit ahead of origin. Baseline 149/149 Node tests passed.

## Implementation

`ui/follow-button.css` extracts the existing arXiv design unchanged: dark + Follow,
gray ✓ Following, 13px semibold font/icons, 5px gap/radius, original padding,
hover/active colors and blue keyboard focus outline. Explicit border-box sizing
preserves the original arXiv 30px geometry on internal pages too. Page-specific
arXiv margins remain local. Author heading typography is unchanged; its flex row
wraps and long names can break without overlapping controls.

`ui/follow-button.js` supplies the same SVGs, state label, aria-pressed and action
label/title. A followed heading announces “Unfollow: [name]” and its tooltip says
“Unfollow [name]”; the visible label stays Following, including on touch. Native
button keyboard activation is retained. The helper has no repository or click logic.
The opt-in arXiv organization action and separate author-heading collection picker
remain unchanged. Existing busy/stale-read guards, desired-state Follow/Unfollow,
all memberships and eight-second Undo remain on their established paths.

No storage, schema, migration, Sync, portable format, navigation, version,
dependency or permission changes. The manifest only loads the extracted CSS and
exposes the small imported presentation module to the existing content context.
Version remains 0.2.0; this does not publish a new store release.

## Verification

- 151/151 Node tests pass: two presentation tests cover labels/icons, accessible
  actions, repeat rendering and opt-in picker semantics; all existing data tests pass.
- Chromium smoke compares computed presentation and icons between real browser
  fixture pages in both states. Existing double-click guards, persistence/reload
  and failed-Undo retry remain covered. Native Space unfollows with organization
  enabled; keyboard Tab focus shows the ring; the collection picker stays visible
  when followed. At 320px the heading controls wrap without overlap or overflow.
- Screenshots of both pages/states were captured and visually inspected. They use
  deterministic abstract/API fixtures, not a claim of current live arXiv rendering.
- Firefox smoke, native transfer/Chrome lifecycle release smoke and both package
  builds pass. Browser versions remain Chrome 154 and Firefox 157. Packages contain
  66 runtime files, unchanged 0.2.0 manifests/permissions and source-identical assets.

The full commit gates remain those in browser-support.md. Account/store/minimum
browser and native macOS/touch assistive-technology manual checks remain unclaimed.
No push, signing or publishing occurs. Generated packages/screenshots are not committed.
