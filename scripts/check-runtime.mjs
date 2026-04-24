const supportedNodeMajorMin = 20;
const supportedNodeMajorMaxExclusive = 25;
const pinnedNodeMajor = 24;

const args = new Set(process.argv.slice(2));
const printPolicyOnly = args.has('--print-policy');

function parseNodeMajor(version) {
  const match = /^v(\d+)\./.exec(version);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

function formatPolicy() {
  return [
    `SubForge runtime policy`,
    `- supported Node.js: >=${supportedNodeMajorMin} <${supportedNodeMajorMaxExclusive}`,
    `- pinned Node.js in repo: ${pinnedNodeMajor} (.nvmrc / .node-version)`,
    `- unsupported example: Node.js ${supportedNodeMajorMaxExclusive}+`
  ].join('\n');
}

const currentNodeVersion = process.version;
const currentNodeMajor = parseNodeMajor(currentNodeVersion);
const nodeIsSupported =
  !Number.isNaN(currentNodeMajor) &&
  currentNodeMajor >= supportedNodeMajorMin &&
  currentNodeMajor < supportedNodeMajorMaxExclusive;

if (printPolicyOnly) {
  console.log(formatPolicy());
  process.exit(0);
}

if (!nodeIsSupported) {
  console.error(
    [
      `SubForge requires Node.js >=${supportedNodeMajorMin} and <${supportedNodeMajorMaxExclusive}.`,
      `Current runtime: ${currentNodeVersion}`,
      `This repository pins Node.js ${pinnedNodeMajor} via .nvmrc and .node-version.`,
      `Node.js ${supportedNodeMajorMaxExclusive}+ is rejected because the current dependency chain can fail during npm ci with native packages such as sharp.`,
      `Switch to Node.js ${pinnedNodeMajor} (recommended) or another supported LTS release before installing dependencies.`
    ].join('\n')
  );
  process.exit(1);
}

console.log(`SubForge runtime check passed on ${currentNodeVersion}.`);
