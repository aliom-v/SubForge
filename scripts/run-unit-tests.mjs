import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const nodeModulesDir = join(repoRoot, 'node_modules');
const namespaceDir = join(nodeModulesDir, '@subforge');
const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

const createdDirs = [];
const createdLinks = [];

function ensureDir(directoryPath) {
  if (existsSync(directoryPath)) {
    return;
  }

  mkdirSync(directoryPath, { recursive: true });
  createdDirs.push(directoryPath);
}

function ensureWorkspaceLink(packageName, targetPath) {
  const linkPath = join(namespaceDir, packageName);

  if (existsSync(linkPath)) {
    return;
  }

  ensureDir(namespaceDir);
  symlinkSync(relative(dirname(linkPath), targetPath), linkPath, symlinkType);
  createdLinks.push(linkPath);
}

function cleanupEmptyDir(directoryPath) {
  if (!existsSync(directoryPath)) {
    return;
  }

  if (readdirSync(directoryPath).length === 0) {
    rmSync(directoryPath, { recursive: true, force: true });
  }
}

function collectTestFiles(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      return collectTestFiles(fullPath);
    }

    return entry.name.endsWith('.test.mjs') ? [fullPath] : [];
  });
}

try {
  ensureDir(nodeModulesDir);
  ensureWorkspaceLink('shared', join(repoRoot, 'packages/shared'));

  const testFiles = collectTestFiles(join(repoRoot, 'tests/unit'));

  const result = spawnSync(process.execPath, ['--import', './scripts/register-ts-loader.mjs', '--test', ...testFiles], {
    cwd: repoRoot,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
} finally {
  for (const linkPath of createdLinks.reverse()) {
    rmSync(linkPath, { force: true, recursive: true });
  }

  cleanupEmptyDir(namespaceDir);

  for (const directoryPath of createdDirs.reverse()) {
    cleanupEmptyDir(directoryPath);
  }
}
