import { Router } from "express";
import { readFileSync, existsSync } from "fs";
import path from "path";
import * as yaml from "js-yaml";

/**
 * Serves the OpenAPI specification and interactive docs.
 *
 *   GET /openapi.json  -> the openapi.yaml file, parsed to JSON (cached).
 *   GET /docs          -> Swagger UI (loaded from CDN) pointing at /openapi.json.
 *
 * The spec is the single source of truth in apps/api/openapi.yaml; this module
 * only reads + serves it, so any endpoint change stays machine-readable for
 * other clients (Postman import, SDK generation, third-party integrators).
 */
const router = Router();

// Candidate locations for openapi.yaml, robust across `tsx` (dev, cwd=apps/api)
// and `node dist/index.js` (build, cwd=apps/api) and repo-root invocations.
const SPEC_CANDIDATES = [
  path.resolve(process.cwd(), "openapi.yaml"),
  path.resolve(process.cwd(), "apps/api/openapi.yaml"),
  path.resolve(process.cwd(), "../openapi.yaml"),
];

let cachedSpec: unknown | null = null;

function loadSpec(): unknown | null {
  if (cachedSpec !== null) return cachedSpec;
  const specPath = SPEC_CANDIDATES.find((p) => existsSync(p));
  if (!specPath) return null;
  cachedSpec = yaml.load(readFileSync(specPath, "utf8")) as unknown;
  return cachedSpec;
}

router.get("/openapi.json", (_req, res) => {
  const spec = loadSpec();
  if (spec === null) {
    return res.status(500).json({ error: "OpenAPI spec not found" });
  }
  res.json(spec);
});

// Minimal, self-contained Swagger UI page served from the unpkg CDN.
const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hoodscan API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          url: "/openapi.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
        });
      };
    </script>
  </body>
</html>`;

router.get("/docs", (_req, res) => {
  res.type("html").send(DOCS_HTML);
});

export default router;
