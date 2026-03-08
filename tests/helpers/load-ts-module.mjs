import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const cache = new Map();
const tempDirectories = new Set();

async function cleanupTempDirectories() {
  await Promise.all(
    [...tempDirectories].map(async (directory) => {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
      }
    })
  );
}

process.once('exit', () => {
  void cleanupTempDirectories();
});

process.once('SIGINT', () => {
  void cleanupTempDirectories().finally(() => process.exit(130));
});

process.once('SIGTERM', () => {
  void cleanupTempDirectories().finally(() => process.exit(143));
});

export async function loadTsModule(relativePath) {
  const entryPoint = resolve(process.cwd(), relativePath);

  if (cache.has(entryPoint)) {
    return cache.get(entryPoint);
  }

  const outputDirectory = mkdtempSync(join(tmpdir(), 'subforge-tests-'));
  const nestedDirectory = join(outputDirectory, 'bundle');
  const outputFile = join(nestedDirectory, `${basename(relativePath).replace(/\.[^.]+$/, '')}.mjs`);

  mkdirSync(nestedDirectory, { recursive: true });
  tempDirectories.add(outputDirectory);

  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    write: false,
    legalComments: 'none'
  });

  writeFileSync(outputFile, result.outputFiles[0].text, 'utf8');

  const module = await import(`${pathToFileURL(outputFile).href}?ts=${Date.now()}`);
  cache.set(entryPoint, module);
  return module;
}
