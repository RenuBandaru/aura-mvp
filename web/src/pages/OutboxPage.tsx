// The simulated post office: every email AURA would send. Nothing is actually sent. Port of build 27's vOutbox.

import { useState } from 'react';
import { get, post } from '../api';
import { useApp } from '../state';
import type { Mail } from '../types';
import { PageHead, useLoad } from '../components/bits';
import { MailList } from '../components/MailList';

export function OutboxPage({ caseId }: { caseId?: string }) {
  const { me, version, boot, toast, changed } = useApp();
  const [who, setWho] = useState(caseId || '');
  const byCase = /^(UC|T)-/.test(who);
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => get<Mail[]>('/outbox' + (who && !byCase ? '?who=' + who : '')), [me.id, version, who]);
  if (error) return <div className="callout bad">{error}</div>;
  const mails = (data || []).filter(m => !byCase || m.ref.id === who).filter(m => !q || (m.subject + m.body + m.ref.title).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead title="Outbox" sub="The simulated post office. Nothing is sent. These are the messages the system would send.">
        {(me.role === 'lead' || me.role === 'admin') && <button className="btn" onClick={() => post<{ casesReminded: number }>('/admin/sweep')
          .then(r => { toast(r.casesReminded ? `Reminders queued on ${r.casesReminded} case${r.casesReminded === 1 ? '' : 's'}.` : 'No reminders were due.'); changed(); })
          .catch(e => toast(e.message, true))}>Run reminder sweep</button>}
      </PageHead>
      <div className="filters">
        <input type="search" placeholder="Search messages" value={q} onChange={e => setQ(e.target.value)} aria-label="Search messages" />
        <select value={who} onChange={e => setWho(e.target.value)} aria-label="Recipient">
          <option value="">Everyone</option>
          {boot.people.filter(p => p.role !== 'admin').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {data ? <MailList mails={mails} /> : <p className="muted">Loading...</p>}
    </>
  );
}
