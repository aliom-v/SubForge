import type { FormEventHandler } from 'react';

import type { NodeEditorState } from '../../app-types';
import type { NodeChainSummary } from '../../mihomo-topology';
import type { NodeUpstreamOption } from '../../node-editor';
import { Drawer, Field } from '../ui';

export function NodeEditorDrawer(props: {
  loading: boolean;
  nodeEditor: NodeEditorState | null;
  nodeEditorIssues: string[];
  editorSummary: NodeChainSummary | null;
  nodeEditorHasLegacyUpstream: boolean;
  nodeEditorUpstreamOptions: NodeUpstreamOption[];
  nodeEditorAdvancedFieldSummary: string;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onChange: (next: NodeEditorState) => void;
}): JSX.Element | null {
  const editor = props.nodeEditor;

  if (!editor) {
    return null;
  }

  return (
    <Drawer
      open
      title={editor.name.trim() || '编辑节点'}
      description="名称、协议、地址、端口、启用状态和上游代理都可以直接改；高级 JSON 只作为兜底入口。"
      onClose={props.onClose}
      onSubmit={props.onSubmit}
      actions={
        <>
          <button type="submit" disabled={props.loading}>
            {props.loading ? '保存中...' : '保存节点'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={props.loading}
            onClick={props.onClose}
          >
            取消
          </button>
        </>
      }
    >
      <div className="inline-meta">
        <span>当前链路：{props.editorSummary?.chain ?? '未找到'}</span>
        <span>当前状态：{props.editorSummary?.issue ?? '正常'}</span>
      </div>
      {props.nodeEditorHasLegacyUpstream ? (
        <p className="helper">
          当前上游是历史引用值。更推荐改成具体节点或 `direct`，这样 Mihomo /
          sing-box 会更一致。
        </p>
      ) : null}
      {props.nodeEditorIssues.length > 0 ? (
        <div className="import-errors">
          <strong>保存前需处理的问题</strong>
          <ul className="overview-list">
            {props.nodeEditorIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Field label="名称">
        <input
          value={editor.name}
          onChange={(event) => props.onChange({ ...editor, name: event.target.value })}
          placeholder="节点名称"
        />
      </Field>
      <Field label="协议">
        <input
          value={editor.protocol}
          onChange={(event) =>
            props.onChange({ ...editor, protocol: event.target.value })
          }
          placeholder="vless / trojan / ss / hysteria2"
        />
      </Field>
      <Field label="地址">
        <input
          value={editor.server}
          onChange={(event) => props.onChange({ ...editor, server: event.target.value })}
          placeholder="example.com"
        />
      </Field>
      <Field label="端口">
        <input
          type="number"
          min={1}
          max={65535}
          value={editor.port}
          onChange={(event) => props.onChange({ ...editor, port: event.target.value })}
          placeholder="443"
        />
      </Field>
      <Field label="启用状态">
        <select
          value={editor.enabled ? 'enabled' : 'disabled'}
          onChange={(event) =>
            props.onChange({
              ...editor,
              enabled: event.target.value === 'enabled'
            })
          }
        >
          <option value="enabled">enabled</option>
          <option value="disabled">disabled</option>
        </select>
      </Field>
      <Field label="上游代理">
        <select
          value={editor.upstreamProxy}
          onChange={(event) =>
            props.onChange({ ...editor, upstreamProxy: event.target.value })
          }
        >
          <option value="">direct</option>
          {props.nodeEditorUpstreamOptions.map((option) => (
            <option
              key={`${option.value}-${option.label}`}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <details className="disclosure compact-disclosure full-span">
        <summary>{props.nodeEditorAdvancedFieldSummary}</summary>
        <div className="disclosure-body">
          <p className="helper">
            只在需要补协议细节、TLS 参数或兼容历史字段时再编辑这里。
          </p>
          <Field label="credentials JSON" full>
            <textarea
              rows={8}
              value={editor.credentialsText}
              onChange={(event) =>
                props.onChange({ ...editor, credentialsText: event.target.value })
              }
              placeholder='{"uuid":"..."}'
            />
          </Field>
          <Field label="params JSON" full>
            <textarea
              rows={8}
              value={editor.paramsText}
              onChange={(event) =>
                props.onChange({ ...editor, paramsText: event.target.value })
              }
              placeholder='{"tls":true,"servername":"example.com"}'
            />
          </Field>
        </div>
      </details>
    </Drawer>
  );
}
