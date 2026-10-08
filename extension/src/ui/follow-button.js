/** Shared presentation only; callers retain their existing repository actions. */
export function setFollowButton(button, pressed, name, organizeCollections = false) {
  button.classList.add("xivary-follow-button");
  button.replaceChildren();
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = pressed ? '<path d="m2.75 8 3.1 3.1 7.4-7.4"/>' : '<path d="M8 3v10M3 8h10"/>';
  button.append(icon);
  const label = document.createElement("span");
  label.textContent = pressed ? "Following" : "Follow";
  button.append(label);
  button.setAttribute("aria-pressed", String(pressed));
  if (pressed && organizeCollections) {
    button.setAttribute("aria-haspopup", "dialog");
    if (!button.hasAttribute("aria-expanded")) button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `Organize collections for: ${name}`);
    button.title = `Organize ${name}`;
  } else {
    button.removeAttribute("aria-haspopup");
    button.removeAttribute("aria-expanded");
    button.setAttribute("aria-label", `${pressed ? "Unfollow" : "Follow"}: ${name}`);
    button.title = pressed ? `Unfollow ${name}` : `Follow ${name}`;
  }
}
