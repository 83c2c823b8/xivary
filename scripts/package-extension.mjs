import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { browserManifest } from "./browser-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const extensionRoot = resolve(repositoryRoot, "extension");
/** Stage identical runtime files with a generated manifest, then ZIP them. */
export async function packageExtension(target = "chromium", outputDirectory = resolve(repositoryRoot, "dist")) {
  const source = JSON.parse(await readFile(resolve(extensionRoot, "manifest.json"), "utf8"));
  const manifest = browserManifest(source, target);
  const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  if (manifest.version !== packageMetadata.version) throw new Error("Manifest/package version mismatch.");

  const files = (await walk(extensionRoot))
    .map(path => relative(extensionRoot, path).replaceAll("\\", "/"))
    .filter(path => path !== "assets/fonts/README.md")
    .sort();
  const developmentOnly = /(^|\/)(?:tests?|scripts?|screenshots?|node_modules|coverage|dist)(?:\/|$)|\.map$/;
  if (files.some(path => path.startsWith(".") || path.includes("/.") || developmentOnly.test(path))) {
    throw new Error("The release archive contains a development-only file.");
  }

  const directory = resolve(outputDirectory, target);
  await rm(directory, { recursive: true, force: true });
  for (const path of files) {
    const destination = resolve(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    if (path === "manifest.json") await writeFile(destination, JSON.stringify(manifest, null, 2) + "\n");
    else await copyFile(resolve(extensionRoot, path), destination);
  }
  const artifact = resolve(outputDirectory, `xivary-${manifest.version}-${target}.zip`);
  await rm(artifact, { force: true });
  run("zip", ["-X", "-q", artifact, ...files], directory);
  return { directory, artifact, manifest, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: node scripts/package-extension.mjs [chromium|firefox]");
  const { artifact, files } = await packageExtension(process.argv[2] || "chromium");
  const bytes = await readFile(artifact);
  console.log(`Packaged ${relative(repositoryRoot, artifact)} (${files.length} files, ${(await stat(artifact)).size} bytes)`);
  console.log(`SHA-256 ${createHash("sha256").update(bytes).digest("hex")}`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release files may not be symbolic links: ${path}`);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}
