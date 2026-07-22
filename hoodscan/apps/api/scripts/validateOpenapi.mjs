/**
 * Validate apps/api/openapi.yaml:
 *   1. It parses as YAML.
 *   2. It looks like an OpenAPI 3 document (openapi/info/paths present).
 *   3. Every local $ref ("#/...") actually resolves within the document.
 *
 * Run:  pnpm openapi:lint   (from repo root or apps/indexer)
 * Exit code 0 = OK, 1 = problem.
 */
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const CANDIDATES = [
  path.resolve(process.cwd(), "openapi.yaml"),
  path.resolve(process.cwd(), "apps/api/openapi.yaml"),
  path.resolve(process.cwd(), "../openapi.yaml"),
];

const specPath = CANDIDATES.find((p) => existsSync(p));
if (!specPath) {
  console.error("[openapi:lint] openapi.yaml not found in:", CANDIDATES);
  process.exit(1);
}

let doc;
try {
  doc = yaml.load(readFileSync(specPath, "utf8"));
} catch (err) {
  console.error("[openapi:lint] YAML parse error:", err.message);
  process.exit(1);
}

const problems = [];

if (typeof doc?.openapi !== "string" || !doc.openapi.startsWith("3.")) {
  problems.push(`missing/invalid "openapi" version (got: ${doc?.openapi})`);
}
if (!doc?.info?.title) problems.push('missing "info.title"');
const pathCount = doc?.paths ? Object.keys(doc.paths).length : 0;
if (pathCount === 0) problems.push('no "paths" defined');

// Resolve a "#/a/b/c" JSON pointer against the document.
function resolvePointer(ref) {
  const parts = ref.slice(2).split("/");
  let node = doc;
  for (const raw of parts) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node && typeof node === "object" && key in node) node = node[key];
    else return false;
  }
  return node !== undefined;
}

let refCount = 0;
const broken = new Set();
(function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(walk);
  for (const [k, v] of Object.entries(node)) {
    if (k === "$ref" && typeof v === "string" && v.startsWith("#/")) {
      refCount++;
      if (!resolvePointer(v)) broken.add(v);
    } else {
      walk(v);
    }
  }
})(doc);

if (broken.size > 0) {
  problems.push(`unresolved $ref(s): ${[...broken].join(", ")}`);
}

if (problems.length > 0) {
  console.error("[openapi:lint] FAIL:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(
  `[openapi:lint] OK — ${pathCount} paths, ${refCount} refs resolved (${path.basename(
    specPath
  )})`
);
