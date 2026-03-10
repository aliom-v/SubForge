import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESOLVE_SUFFIXES = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];
const TRANSFORM_LOADERS = new Map([
  ['.ts', 'ts'],
  ['.tsx', 'tsx']
]);

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function hasExplicitExtension(specifier) {
  return /\.[a-z0-9]+$/i.test(specifier);
}

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (!isRelativeSpecifier(specifier) || hasExplicitExtension(specifier)) {
      throw error;
    }

    for (const suffix of RESOLVE_SUFFIXES) {
      try {
        return await defaultResolve(`${specifier}${suffix}`, context, defaultResolve);
      } catch {
        // try next candidate
      }
    }

    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (!url.startsWith('file:')) {
    return defaultLoad(url, context, defaultLoad);
  }

  const filename = fileURLToPath(url);
  const loader = TRANSFORM_LOADERS.get(extname(filename));

  if (!loader) {
    return defaultLoad(url, context, defaultLoad);
  }

  const source = await readFile(filename, 'utf8');
  const result = await transform(source, {
    loader,
    format: 'esm',
    target: 'node20',
    sourcefile: filename,
    sourcemap: 'inline'
  });

  return {
    format: 'module',
    source: result.code,
    shortCircuit: true
  };
}
