import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist");
const fixedAssets = [
  "index.html",
  "styles.css",
  "app.js",
  "journal-store.js",
  "catalogue.js",
  "tracker.js",
  "favicon.svg",
  "metadata.json",
  "vacancies.sqlite",
  "source.html",
  "source.css",
  "source.js",
  "sources.json",
  "robots.txt",
  "vendor/sql-wasm.js",
  "vendor/sql-wasm.wasm",
];

const sourceMap = JSON.parse(await readFile(join(root, "sources.json"), "utf8"));
const sourceAssets = [...new Set(Object.values(sourceMap).map(({file}) => {
  if (typeof file !== "string" || file.startsWith("/") || file.split(/[\\/]/).includes("..")) {
    throw new Error("sources.json contains an unsafe source path");
  }
  return `sources/${file}`;
}))].sort();

for (const relative of [...fixedAssets, ...sourceAssets]) {
  const sourcePath = join(root, relative);
  const info = await stat(sourcePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`Required public asset is missing: ${relative}`);
  if (!resolve(sourcePath).startsWith(`${root}${sep}`)) throw new Error(`Asset path escapes the repository: ${relative}`);
}

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
for (const relative of [...fixedAssets, ...sourceAssets]) {
  const destination = join(output, relative);
  await mkdir(dirname(destination), {recursive: true});
  await cp(join(root, relative), destination);
}

const copied = [...fixedAssets, ...sourceAssets];
const fileCount = (await readdir(output, {recursive: true, withFileTypes: true})).filter((entry) => entry.isFile()).length;
if (fileCount !== copied.length) throw new Error(`Unexpected dist contents: expected ${copied.length} files, found ${fileCount}`);
console.log(`Built ${fileCount} public assets in dist/`);
