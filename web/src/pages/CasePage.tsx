// One use case: its header and stage, the sections in tabs, and the "Next step" rail with every action
// the person you are viewing as can take. Port of build 27's vCase and railHtml.
//
// Flow: load the case page from the API (which runs actions_for for this person), show the actions as
// buttons, open a dialog for the one picked, send it, and replace the page with what the API returns.

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { Action, CaseDetail, Dict } from '../types';
import { fdate } from '../format';
import { TierChip, GapChips, useLoad } from '../components/bits';
import { ActionDialog } from '../components/ActionDialog';
import { EvidenceDialog } from '../components/EvidenceDialog';
import { FormEditor, draftFrom, DraftForm } from '../components/FormEditor';
import { Activity, Assessment, ControlsEvidence, Reviews, UseCaseView } from '../components/CaseSections';
import { MailList } from '../components/MailList';
import { HoldingPanel, ReadinessCard } from '../components/CaseRedesign';

const IP_TEXT = 'All AI models, datasets and outputs this use case produces are to be treated as corporate intellectual property, as the AI governance policy requires.';
const STEPS = ['suggestion', 'use_case', 'vetting', 'panel', 'exec', 'pilot', 'production'];
const FORM_ACTIONS = new Set(['submit', 'save_draft', 'signoff_accept']);

export function CasePage({ id }: { id: string }) {
  const { me, version, changed, toast, boot, name } = useApp();
  const { data, error } = useLoad(() => get<CaseDetail>('/cases/' + id), [id, me.id, version]);
  const [d, setD] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState('uc');
  const [open, setOpen] = useState<Action | null>(null);
  const [openExtra, setOpenExtra] = useState<Dict | undefined>();
  const [evidence, setEvidence] = useState(false);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [preview, setPreview] = useState<Dict | null>(null);
  const [ipAsk, setIpAsk] = useState<string | null>(null); // the form action waiting for the IP acknowledgement
  const [showGaps, setShowGaps] = useState(false);

  useEffect(() => { setD(data); setDraft(data?.editable ? draftFrom(data.case.form) : null); setShowGaps(false); }, [data]);

  if (error) return <div className="stack"><BackLink /><div className="callout bad">{error}</div></div>;
  if (!d) return <p className="muted">Loading...</p>;
  const c = d.case;

  const done = (next: CaseDetail) => { setD(next); setDraft(next.editable ? draftFrom(next.case.form) : null); setOpen(null); setEvidence(false); changed(); };

  /** Submit, save or accept the form being edited. Mirrors build 27's ucsubmit / ucsave / ucaccept. */
  const formAction = async (aid: string, ack = false) => {
    if (!draft) return;
    const a = d.actions.find(x => x.id === aid);
    if (a?.blockedMsg && aid !== 'save_draft') { toast(a.blockedMsg, true); return; }
    if (aid !== 'save_draft') {
      if (preview?.submitGaps?.count) { setShowGaps(true); setTab('uc'); toast('Some answers are still missing. They are listed above the form.', true); return; }
      if (!ack) { setIpAsk(aid); return; }
    }
    try {
      const r = await post<CaseDetail>(`/cases/${c.id}/actions/${aid}`, { input: { form: draft, ...(ack ? { ipAck: true } : {}) } });
      done(r);
      const rc = r.case;
      toast(aid === 'save_draft' ? 'Draft saved.' : rc.signoff?.status === 'requested' && rc.stage === 'use_case' ? 'Sign-off requested from ' + name(rc.signoff.ownerId) + '.'
        : rc.stage === 'use_case' ? 'Triage sent it back. See the reasons at the top.' : 'Passed triage and scored ' + boot.tierLabels[rc.tier] + '.');
    } catch (e: any) { toast(e.message, true); }
  };

  const openAction = (a: Action) => {
    if (a.id === 'add_evidence') { setEvidence(true); return; }
    if (!a.fields.length && !a.intro && !a.disabled && a.id !== 'remove_evidence') { quick(a); return; }
    setOpenExtra(undefined);
    setOpen(a);
  };
  const quick = async (a: Action, extra?: Dict) => {
    try { done(await post<CaseDetail>(`/cases/${c.id}/actions/${a.id}`, { input: extra || {} })); toast('Done: ' + a.label); } catch (e: any) { toast(e.message, true); }
  };
  const removeEvidence = (evidenceId: string) => {
    const a = d.actions.find(x => x.id === 'remove_evidence' && x.evidenceId === evidenceId);
    if (a && window.confirm('Remove this evidence?')) quick(a, { evidenceId });
  };

  const tabs: [string, string, React.ReactNode][] = [
    ['uc', 'Use case', d.editable && draft ? <FormEditor caseId={c.id} form={draft} setForm={setDraft} onPreview={setPreview} /> : <UseCaseView d={d} />],
    ['assess', 'Assessment', <Assessment d={d} />],
    ['ctl', 'Controls and evidence', <ControlsEvidence d={d} onRemoveEvidence={removeEvidence} />],
    ['rev', 'Reviews and decisions', <Reviews d={d} />],
    ['act', 'Activity', <Activity d={d} />],
    ['mail', `Emails (${(c.outbox || []).length})`, <MailList mails={(c.outbox || []).map((m: Dict) => ({ ...m, ref: { id: c.id, title: c.title } })).reverse()} />],
  ];
  const buttons = d.actions.filter(a => !FORM_ACTIONS.has(a.id) && a.id !== 'remove_evidence');
  const formActs = d.editable ? d.actions.filter(a => FORM_ACTIONS.has(a.id)) : [];
  const gaps = preview?.submitGaps;

  return (
    <div>
      <BackLink />
      <div className="casehead">
        <div className="idrow"><span className="mono muted">{c.id}</span><h1>{c.title}</h1><TierChip tier={c.tier} label={boot.tierLabels[c.tier]} /><GapChips row={d.row} /></div>
        <div className="stepper" aria-label="Stage">{STEPS.map(s => {
          const at = STEPS.indexOf(c.stage), i = STEPS.indexOf(s);
          return <span key={s} className={c.stage === s ? 'now' : i < at ? 'done' : ''}>{boot.stageLabels[s]}</span>;
        })}{c.stage === 'closed' && <span className="now">Closed</span>}</div>
      </div>
      <div className="caselayout">
        <div className="stack">
          {c.returned && c.stage === 'use_case' && <div className="callout warn"><b>{c.returned.from === 'owner' ? 'The owner declined sign-off' : 'Returned for remediation (' + c.returned.from + ')'}</b>
            <span style={{ whiteSpace: 'pre-wrap' }}>{c.returned.reason}</span></div>}
          {c.stage === 'closed' && c.closed && <div className="callout bad"><b>{c.closed.notPermitted ? 'Closed and marked not permitted' : 'Closed with reason'}</b><span>{c.closed.reason}</span></div>}
          {c.signoff?.status === 'requested' && c.stage === 'use_case' && <div className="callout">{name(c.signoff.requestedBy)} asked {name(c.signoff.ownerId)} to sign off as owner.</div>}
          {showGaps && gaps?.count > 0 && <div className="callout warn"><b>Still to answer before you submit</b>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{[...gaps.fields, ...gaps.questions.map((q: Dict) => q.text), ...gaps.readiness.map((r: Dict) => r.text)].map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>}
          <HoldingPanel d={d} />
          <div>
            <div className="tabs" role="tablist" aria-label="Use case sections">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={k === tab} onClick={() => setTab(k)}>{l}</button>)}</div>
            {tabs.find(t => t[0] === tab)?.[2]}
          </div>
        </div>
        <aside className="rail" aria-label="Actions and facts">
          <div className="card"><h2>Next step</h2>
            {formActs.length > 0 && <div className="actions" style={{ marginBottom: 10 }}>
              <p className="muted small">Complete the form on this page, then use these buttons.</p>
              {formActs.filter(a => a.id !== 'save_draft').map(a => <button key={a.id} className="btn primary" onClick={() => formAction(a.id)}>
                {a.id === 'signoff_accept' ? 'Accept and submit for triage' : (c.form?.ownerId || c.submitterId) === me.id || draft?.ownerId === me.id ? 'Submit for triage' : 'Request owner sign-off'}</button>)}
              {formActs.some(a => a.id === 'save_draft') && <button className="btn" onClick={() => formAction('save_draft')}>Save draft</button>}
            </div>}
            {buttons.length ? <div className="actions">{buttons.map(a => <div key={a.id}>
              <button className={'btn ' + (a.tone === 'primary' ? 'primary' : a.tone === 'danger' ? 'danger' : '')} aria-disabled={a.disabled || undefined} onClick={() => openAction(a)}>{a.label}</button>
              {a.disabled && a.why && <p className="why">{a.why}</p>}
              {a.id === 'rv_vote' && (d.holding?.firmBlocked || []).length > 0 && <p className="why">Only a leaning decision for now. {d.holding!.firmBlocked.join(' ')}</p>}</div>)}</div>
              : !formActs.length && <WaitingOn d={d} />}
          </div>
          <ReadinessCard d={d} />
          <div className="card"><h2>Facts</h2><dl className="facts">
            <dt>Stage</dt><dd>{boot.stageLabels[c.stage]}</dd>
            <dt>Submitter</dt><dd>{name(c.submitterId)}</dd>
            {c.form?.ownerId && <><dt>Owner</dt><dd>{name(c.form.ownerId)}</dd></>}
            {c.adviserId && <><dt>Adviser</dt><dd>{name(c.adviserId)}</dd></>}
            {c.dueAt && c.stage !== 'closed' && <><dt>Due</dt><dd>{fdate(c.dueAt)}</dd></>}
            <dt>Logged</dt><dd>{fdate(c.createdAt)}</dd>
            {d.waitingOn.length > 0 && <><dt>Waiting for</dt><dd className="small">{d.waitingOn.map(name).join(', ')}</dd></>}
          </dl></div>
        </aside>
      </div>
      {open && <ActionDialog caseId={c.id} action={open} extra={openExtra} onClose={() => setOpen(null)} onDone={done} />}
      {evidence && <EvidenceDialog d={d} onClose={() => setEvidence(false)} onDone={done} />}
      {ipAsk && <div className="modalbg"><div className="modal" role="dialog" aria-modal="true" aria-label="Intellectual property">
        <div className="phead"><h2>Before you submit</h2></div><div className="pbody"><p>{IP_TEXT}</p></div>
        <div className="pfoot"><button className="btn primary" onClick={() => { const a = ipAsk; setIpAsk(null); formAction(a, true); }}>I understand, submit</button>
          <button className="btn ghost" onClick={() => setIpAsk(null)}>Cancel</button></div></div></div>}
    </div>
  );
}

const BackLink = () => <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => go('cases')}>&larr; Back to use cases</button>;

/** Who the case is waiting for, when the viewer has nothing to do. Port of build 27's waitingOn (short form). */
function WaitingOn({ d }: { d: CaseDetail }) {
  const { me, name } = useApp();
  if (me.role === 'auditor') return <p className="muted">Read-only access. The auditor can see every case, decision and audit entry but takes no action.</p>;
  if (me.role === 'admin') return <p className="muted">The demo admin only manages rules and data.</p>;
  return <p className="muted">Nothing for {me.name} to do on this case.{d.waitingOn.length ? <> Waiting for <b>{d.waitingOn.map(name).join(', ')}</b>. Use "Viewing as" at the top to switch to them.</> : null}</p>;
}
