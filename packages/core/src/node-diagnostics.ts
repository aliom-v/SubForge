import { canonicalizeNodeProtocol } from './node-protocol-validation';

export interface NodeDiagnosticInput {
  name: string;
  protocol: string;
  params?: Record<string, unknown> | null;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function looksLikeRealityStyleVless(params: Record<string, unknown> | null): boolean {
  if (!params) {
    return false;
  }

  const tlsEnabled = readBoolean(params.tls) === true;
  const network = readNonEmptyString(params.network).toLowerCase();
  const flow = readNonEmptyString(params.flow).toLowerCase();
  const shortId = readNonEmptyString(params.sid);

  if (!tlsEnabled) {
    return false;
  }

  if (network && network !== 'tcp') {
    return false;
  }

  return Boolean(shortId) || flow === 'xtls-rprx-vision';
}

export function buildImportedNodeWarnings(nodes: NodeDiagnosticInput[]): string[] {
  const warnings: string[] = [];

  for (const node of nodes) {
    const protocol = canonicalizeNodeProtocol(node.protocol);
    const params = node.params ?? null;

    if (protocol === 'vless' && looksLikeRealityStyleVless(params)) {
      const publicKey = readNonEmptyString(params?.pbk);

      if (!publicKey) {
        warnings.push(
          `节点“${node.name}”看起来像 Reality / Vision 的 VLESS 节点，但缺少 public key（reality-opts.public-key / params.pbk）。如果这是 Reality 节点，导出后客户端通常会显示为不可用。`
        );
      }
    }
  }

  return [...new Set(warnings)];
}
