const RESOLVE_SUFFIXES = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

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
