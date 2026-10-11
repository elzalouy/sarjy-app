import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");

const directories = [
  "src/app/api",
  "src/components",
  "src/features/auth",
  "src/features/conversations",
  "src/features/memory",
  "src/features/voice",
  "src/server/auth",
  "src/server/config",
  "src/server/conversations",
  "src/server/database",
  "src/server/integrations",
  "src/server/memory",
  "src/server/shared",
  "src/server/weather",
];

const zones: Array<{ target: string; from: string }> = [
  { target: "src/components", from: "src/features" },
  { target: "src/components", from: "src/server" },
  { target: "src/components", from: "src/app" },
  { target: "src/features", from: "src/server" },
  { target: "src/features", from: "src/app" },
  { target: "src/app", from: "src/server/database" },
  { target: "src/app", from: "src/server/integrations" },
  { target: "src/server", from: "src/app" },
  { target: "src/server", from: "src/components" },
  { target: "src/server", from: "src/features" },
  { target: "src/server/config", from: "src/server/auth" },
  { target: "src/server/config", from: "src/server/conversations" },
  { target: "src/server/config", from: "src/server/database" },
  { target: "src/server/config", from: "src/server/integrations" },
  { target: "src/server/config", from: "src/server/memory" },
  { target: "src/server/config", from: "src/server/shared" },
  { target: "src/server/config", from: "src/server/weather" },
  { target: "src/server/shared", from: "src/server/auth" },
  { target: "src/server/shared", from: "src/server/conversations" },
  { target: "src/server/shared", from: "src/server/database" },
  { target: "src/server/shared", from: "src/server/integrations" },
  { target: "src/server/shared", from: "src/server/memory" },
  { target: "src/server/shared", from: "src/server/weather" },
  { target: "src/server/database", from: "src/server/auth" },
  { target: "src/server/database", from: "src/server/conversations" },
  { target: "src/server/database", from: "src/server/integrations" },
  { target: "src/server/database", from: "src/server/memory" },
  { target: "src/server/database", from: "src/server/weather" },
  { target: "src/server/integrations", from: "src/server/auth" },
  { target: "src/server/integrations", from: "src/server/conversations" },
  { target: "src/server/integrations", from: "src/server/database" },
  { target: "src/server/integrations", from: "src/server/memory" },
  { target: "src/server/integrations", from: "src/server/weather" },
  { target: "src/server/auth", from: "src/server/conversations" },
  { target: "src/server/auth", from: "src/server/memory" },
  { target: "src/server/auth", from: "src/server/weather" },
  { target: "src/server/conversations", from: "src/server/auth" },
  { target: "src/server/conversations", from: "src/server/memory" },
  { target: "src/server/conversations", from: "src/server/weather" },
  { target: "src/server/memory", from: "src/server/auth" },
  { target: "src/server/memory", from: "src/server/conversations" },
  { target: "src/server/memory", from: "src/server/weather" },
  { target: "src/server/weather", from: "src/server/auth" },
  { target: "src/server/weather", from: "src/server/conversations" },
  { target: "src/server/weather", from: "src/server/memory" },
];

test("agreed source directories exist", async () => {
  for (const directory of directories) {
    const entries = await readdir(path.join(root, directory));
    assert.ok(Array.isArray(entries));
  }
});

test("source imports follow the module boundaries", async () => {
  const files = await listSourceFiles(path.join(root, "src"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const filePath = toSrcPath(file);

    if (
      filePath.startsWith("src/server/") &&
      !source.includes('import "server-only"')
    ) {
      violations.push(`${filePath} must import "server-only"`);
    }

    for (const specifier of importSpecifiers(source)) {
      const imported = resolveInternalImport(file, specifier);
      if (!imported) {
        continue;
      }
      for (const zone of zones) {
        if (inside(filePath, zone.target) && inside(imported, zone.from)) {
          violations.push(`${filePath} imports ${imported}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      if (!entry.name.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /import\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

function resolveInternalImport(file: string, specifier: string): string | null {
  let absolute: string;
  if (specifier.startsWith("@/")) {
    absolute = path.join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    absolute = path.resolve(path.dirname(file), specifier);
  } else {
    return null;
  }
  return stripTypeScriptExtension(toSrcPath(absolute));
}

function toSrcPath(file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function stripTypeScriptExtension(file: string): string {
  return file.replace(/\.(tsx|ts)$/, "");
}

function inside(file: string, folder: string): boolean {
  return file === folder || file.startsWith(`${folder}/`);
}
