import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const platformSpecificEsbuild = /^@esbuild\/(?:aix|android|darwin|freebsd|linux|netbsd|openbsd|sunos|win32)-/;

function directDependencies(manifest) {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies
  };
}

test("root manifest does not directly depend on a platform-specific esbuild binary", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const platformPackages = Object.keys(directDependencies(manifest)).filter((name) =>
    platformSpecificEsbuild.test(name)
  );

  assert.deepEqual(
    platformPackages,
    [],
    "Platform-specific esbuild packages must remain transitive optional dependencies"
  );
});

test("lockfile root package remains platform-independent", () => {
  const lockfile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const rootPackage = lockfile.packages?.[""] ?? {};
  const platformPackages = Object.keys(directDependencies(rootPackage)).filter((name) =>
    platformSpecificEsbuild.test(name)
  );

  assert.deepEqual(
    platformPackages,
    [],
    "The lockfile root package must not pin a platform-specific esbuild binary"
  );
});
