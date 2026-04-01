import { useEffect, type FormEventHandler, type ReactNode } from 'react';

export function Field(props: { label: string; children: ReactNode; full?: boolean }): JSX.Element {
  return (
    <label className={props.full ? 'full-span' : undefined}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function ResourceTable(props: { columns: string[]; rows: Array<Array<ReactNode>> }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length > 0 ? (
            props.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={props.columns.length}>暂无数据</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Drawer(props: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element | null {
  useEffect(() => {
    if (!props.open) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        props.onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) {
    return null;
  }

  return (
    <div className="drawer-backdrop" onClick={props.onClose}>
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <h3>{props.title}</h3>
            {props.description ? <p className="helper">{props.description}</p> : null}
          </div>
          <button type="button" className="secondary drawer-close" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <form className="drawer-form" onSubmit={props.onSubmit}>
          <div className="drawer-body">{props.children}</div>
          {props.actions ? <div className="drawer-actions">{props.actions}</div> : null}
        </form>
      </aside>
    </div>
  );
}
