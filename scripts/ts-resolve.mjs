import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Lets a plain node script import the app's TypeScript modules directly.
 *
 * Node strips the types by itself; what it can't do is resolve the two things
 * a bundler normally handles — the `@/` alias from tsconfig, and imports
 * written without a file extension. Both are added here, so the importer can
 * reuse `src/lib/store.ts` instead of growing a second copy of the SQL.
 */

const SRC = path.resolve(import.meta.dirname, "..", "src");

function withExtension(filePath) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  for (const candidate of [`${filePath}.ts`, `${filePath}.tsx`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return filePath;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = withExtension(path.join(SRC, specifier.slice(2)));
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    return nextResolve(specifier, context);
  },
});
