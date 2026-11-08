// The simulated post office: every email AURA would send. Nothing is actually sent. Port of build 27's vOutbox.

import { useState } from 'react';
import { get } from '../api';
import { useApp } from '../state';
import type { Mail } from '../types';
import { PageHead, useLoad } from '../components/bits';
import { MailList } from '../components/MailList';

export function OutboxPage() {
  const { me, version, boot } = useApp();
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => get<Mail[]>('/outbox' + (who ? '?who=' + who : '')), [me.id, version, who]);
  if (error) return <div className="callout bad">{error}</div>;
  const mails = (data || []).filter(m => !q || (m.subject + m.body + m.ref.title).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead title="Outbox" sub="The simulated post office. Nothing is sent. These are the messages the system would send." />
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search messages" value={q} onChange={e => setQ(e.target.value)} aria-label="Search messages"
          style={{ padding: '7px 9px', border: '1px solid var(--line-2)', borderRadius: 6, minWidth: 240 }} />
        <select value={who} onChange={e => setWho(e.target.value)} aria-label="Recipient" style={{ padding: '7px 9px', borderRadius: 6 }}>
          <option value="">Everyone</option>
          {boot.people.filter(p => p.role !== 'admin').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {data ? <MailList mails={mails} showRef /> : <p className="muted">Loading...</p>}
    </>
  );
}
