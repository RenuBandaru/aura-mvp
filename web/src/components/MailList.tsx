// A list of simulated emails, each expandable to its full text.

import { useApp } from '../state';
import type { Mail } from '../types';
import { fdatetime } from '../format';

export function MailList({ mails, showRef }: { mails: Mail[]; showRef?: boolean }) {
  const { name } = useApp();
  if (!mails.length) return <p className="muted">No messages.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {mails.slice(0, 150).map((m, i) => (
        <details key={i} className="msg">
          <summary><b>{m.subject}</b><span className="chip">{m.kind || 'message'}</span>
            <span className="muted small">To {m.to.map(name).join(', ')}</span><span className="muted small">{fdatetime(m.ts)}</span></summary>
          <pre>{m.body}</pre>
          {showRef && m.ref && /^UC-/.test(m.ref.id) && <p className="small"><a href={'#/case/' + m.ref.id}>Open {m.ref.id}</a></p>}
        </details>
      ))}
    </div>
  );
}
