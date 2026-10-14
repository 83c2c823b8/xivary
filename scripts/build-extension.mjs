import { packageExtension } from "./package-extension.mjs";

// Production runtime trees, using the release pipeline without creating archives.
for (const target of ["chromium", "firefox"]) {
  const { directory, files, manifest } = await packageExtension(target, undefined, { archive: false });
  console.log(`Built ${target} ${manifest.version}: ${files.length} runtime files in ${directory}; no ZIP`);
}
