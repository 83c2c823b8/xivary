import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const extensionRoot = resolve(repositoryRoot, "extension");
const outputDirectory = resolve(repositoryRoot, "dist");
const manifest = JSON.parse(await readFile(resolve(extensionRoot, "manifest.json"), "utf8"));
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));

if (manifest.manifest_version !== 3) throw new Error("Release packaging requires Manifest V3.");
if (manifest.version !== packageMetadata.version) {
  throw new Error(`Version mismatch: manifest ${manifest.version}, package ${packageMetadata.version}.`);
}

const excluded = new Set(["assets/fonts/README.md"]);
const files = (await walk(extensionRoot))
  .map(path => relative(extensionRoot, path).replaceAll("\\", "/"))
  .filter(path => !excluded.has(path))
  .sort();

if (!files.includes("manifest.json")) throw new Error("The release archive would not contain manifest.json.");
const developmentOnly = /(^|\/)(?:tests?|scripts?|screenshots?|node_modules|coverage|dist)(?:\/|$)|\.map$/;
if (files.some(path => path.startsWith(".") || path.includes("/.") || developmentOnly.test(path))) {
  throw new Error("The release archive contains a development-only file.");
}

await mkdir(outputDirectory, { recursive: true });
const artifact = resolve(outputDirectory, `xivary-${manifest.version}.zip`);
await rm(artifact, { force: true });
run("zip", ["-X", "-q", artifact, ...files], extensionRoot);

const bytes = await readFile(artifact);
const hash = createHash("sha256").update(bytes).digest("hex");
console.log(`Packaged ${relative(repositoryRoot, artifact)} (${files.length} files, ${(await stat(artifact)).size} bytes)`);
console.log(`SHA-256 ${hash}`);

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
