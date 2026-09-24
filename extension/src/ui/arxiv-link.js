export function configureArxivLink(link, openInNewTab) {
  link.dataset.arxivLink = "true";
  link.rel = "noopener";
  if (openInNewTab) link.target = "_blank";
  else link.removeAttribute("target");
  return link;
}
