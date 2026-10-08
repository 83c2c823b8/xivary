# Reusable design principles

These principles apply to research tools, desktop applications and Android
applications. Concrete Xivary CSS values are in [UI_DESIGN.md](UI_DESIGN.md);
reuse the reasoning, then choose dimensions and input conventions for the platform.

## 1. Content first

Give the user's work the most attention. Make primary actions obvious; keep
metadata, counts and management controls quieter. Test with real names, long
content and realistic density. A useful screen need not fill every empty area.

## 2. Progressive disclosure

Keep common actions direct and reveal infrequent ones through predictable menus
or contextual controls. Discoverability still matters: menu triggers must remain
available to keyboard and touch users. Do not hide required actions behind hover.

## 3. Consistent visual and interaction semantics

The same operation should look and behave similarly across screens. Shared
presentation helpers can prevent drift without coupling unrelated data models.
Different consequences must remain distinguishable even when controls share a
shape. Prefer a few stable conventions over a large framework.

## 4. Keyboard-first where appropriate

Desktop workflows should support efficient keyboard use alongside pointer input.
Preserve native activation, visible focus, Escape dismissal, logical Tab order
and focus return. Do not invent shortcuts that conflict with typing or platform
commands. Mobile platforms need equivalent reachable touch actions, not mandatory
hardware-keyboard gestures.

## 5. Forgiving interactions

For ordinary reversible actions, act immediately and offer brief, nonblocking
Undo. Restore only affected state, preserve metadata and reject stale restoration
rather than overwriting newer changes. For high-impact aggregate deletion, confirm
with the actual consequence and safe initial focus. Do not ask users to confirm
every routine action. Failures must remain visible and recoverable.

## 6. Composable operations

Vim's command grammar illustrates the value of predictable combinations: scope,
operation and target can be composed instead of requiring a unique control for
every combination. A tool can apply the same Rename/Delete verbs to any selected
collection, or the same membership operation to different items. Keep terminology
and boundaries stable; distinguish changing membership from deleting an entity.
This is an interaction principle, not a requirement to copy modal Vim shortcuts
into touch applications or hide essential actions.

## 7. Minimal visual clutter

Use restrained surfaces, subtle dividers and a small icon vocabulary. Remove
unneeded explanations and repeated controls. Do not trade clarity or clickable
hit areas for density. Save decorative effects for a demonstrated purpose such
as separating a floating surface from the content beneath it.

## 8. Clear information hierarchy

Choose a few typography levels. Align labels, actions and counts; reserve space
so hover and loading do not shift rows. Distinguish aggregate views from named
containers. Separate truly empty content from an empty filtered result, preserving
the query and offering a clear recovery action.

## 9. Accessibility and robust state

Use semantic controls and meaningful names; color alone must not convey state.
Maintain contrast, focus visibility and sufficiently sized interactive targets.
Handle long text, large counts, zoom and narrow windows. Avoid focus traps outside
modal dialogs. Guard asynchronous submissions, keep local data safe and surface
errors without pretending that failure is an empty result.

## 10. Respect platform conventions

Use native link modifiers, dialogs, file selection and browser popup behavior
where appropriate. On Android, respect navigation/back, touch targets, text scaling
and system accessibility. Desktop density is not a mobile sizing standard.
Document deliberate deviations and test them on actual rendered surfaces.

## A practical review loop

Inspect the existing interaction and data contracts before changing presentation.
Capture representative screens, change a small coherent set of controls, inspect
normal/hover/focus/disabled states and test the complete workflow. Include long
names, narrow viewports and failures. Automated behavior tests protect correctness;
actual screenshot review checks proportions and visual weight. Report simulation,
real-browser fixture checks and manual platform verification separately.
