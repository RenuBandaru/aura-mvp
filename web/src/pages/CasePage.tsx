// One use case: its header and stage, the sections in tabs, and the "Next step" rail with every action
// the person you are viewing as can take. Port of build 27's vCase and railHtml.
//
// Flow: load the case page from the API (which runs actions_for for this person), show the actions as
// buttons, open a dialog for the one picked, send it, and replace the page with what the API returns.

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { Action, CaseDetail, Dict } from '../types';
import { fdate, fdateShort, money } from '../format';
import { DueAlert, TierGauge, useLoad, Backdrop } from '../components/bits';
import { ActionDialog } from '../components/ActionDialog';
import { EvidenceDialog } from '../components/EvidenceDialog';
import { FormEditor, draftFrom, DraftForm } from '../components/FormEditor';
import { Activity, Assessment, Briefing, ControlsEvidence, DataTab, Reviews, TermsTab, UseCaseView, hasAssessment, hasReviews, hasTerms } from '../components/CaseSections';
import { MailList } from '../components/MailList';

const IP_TEXT = 'All AI models, datasets and outputs this use case produces are to be treated as corporate intellectual property, as the AI governance policy requires.';
const STEPS = ['suggestion', 'use_case', 'vetting', 'panel', 'exec', 'pilot', 'production'];
const ALERT = '\u26A0';
const RET_FROM: Record<string, string> = { triage: 'triage', vetting: 'vetting', panel: 'the panel', exec: 'executives', monitoring: 'monitoring' };
const CLOSED_FROM: Record<string, string> = { panel: 'panel', exec: 'executive', pilot: 'pilot review' };
const FORM_ACTIONS = new Set(['submit', 'save_draft', 'signoff_accept']);

export function CasePage({ id }: { id: string }) {
  const { me, version, changed, toast, boot, name } = useApp();
  const { data, error } = useLoad(() => get<CaseDetail>('/cases/' + id), [id, me.id, version]);
  const [d, setD] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState('uc');
  const [open, setOpen] = useState<Action | null>(null);
  const [openExtra, setOpenExtra] = useState<Dict | undefined>();
  const [evidence, setEvidence] = useState<string | false>(false); // the control to add evidence for, or '' for any
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [preview, setPreview] = useState<Dict | null>(null);
  const [ipAsk, setIpAsk] = useState<string | null>(null); // the form action waiting for the IP acknowledgement
  const [showGaps, setShowGaps] = useState(false);
  // Build 27's soft check before submitting (the API's softGaps): claimed controls nobody confirms, recommended controls not claimed.
  const [soft, setSoft] = useState<{ from: string; noConf: string[]; unclaimed: string[] } | null>(null);
  const [softOk, setSoftOk] = useState(false); // "Submit anyway" was chosen, so do not ask again on this page
  const [jump, setJump] = useState<{ k: string; n: number } | undefined>(); // tells the form which section to show

  useEffect(() => { setD(data); setDraft(data?.editable ? draftFrom(data.case.form) : null); setShowGaps(false); }, [data]);

  if (error) return <div className="stack"><BackLink /><div className="callout bad">{error}</div></div>;
  if (!d) return <p className="muted">Loading...</p>;
  const c = d.case;

  const done = (next: CaseDetail) => { setD(next); setDraft(next.editable ? draftFrom(next.case.form) : null); setOpen(null); setEvidence(false); changed(); };

  /** Submit, save or accept the form being edited. Mirrors build 27's ucsubmit / ucsave / ucaccept. */
  const formAction = async (aid: string, ack = false, softDone = false) => {
    if (!draft) return;
    const a = d.actions.find(x => x.id === aid);
    if (a?.blockedMsg && aid !== 'save_draft') { toast(a.blockedMsg, true); return; }
    if (aid !== 'save_draft') {
      // Check the form as it is now, not the last live preview, which may be a moment behind the typing.
      let p: Dict;
      try { p = await post<Dict>(`/cases/${c.id}/preview`, { form: draft }); setPreview(p); } catch (e: any) { toast(e.message, true); return; }
      if (p.submitGaps?.count) { setShowGaps(true); setTab('uc'); toast('Some answers are still missing. They are listed above the form.', true); return; }
      const g = p.softGaps || { noConf: [], unclaimed: [] };
      if (!softOk && !softDone && !ack && (g.noConf.length || g.unclaimed.length)) { setSoft({ from: aid, ...g }); return; }
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
    if (a.id === 'add_evidence') { setEvidence(''); return; }
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
  const removeControl = (controlId: string) => {
    const a = d.actions.find(x => x.id === 'remove_control');
    if (a) quick(a, { controlId });
  };

  // Tabs in build 27's order (CTABS); a tab shows only when it has something in it. Emails is a React addition.
  const editing = !!(d.editable && draft);
  const all: [string, string, React.ReactNode, boolean][] = [
    ['brief', 'Executive briefing', <Briefing c={c} />, c.stage === 'exec' && !!c.briefing],
    ['uc', 'Use case', editing ? <FormEditor caseId={c.id} form={draft!} setForm={setDraft} onPreview={setPreview} unitId={c.unitId}
      accepting={d.actions.some(a => a.id === 'signoff_accept')} returned={!!c.returned} jump={jump} /> : <UseCaseView d={d} />, true],
    ['assess', 'Assessment', <Assessment d={d} editing={editing} />, hasAssessment(d, editing)],
    ['ctl', 'Controls and evidence', <ControlsEvidence d={d} onAddEvidence={id => setEvidence(id)} onRemoveEvidence={removeEvidence} onRemoveControl={removeControl} />,
      !editing && c.stage !== 'suggestion' && (d.support?.rows || []).length > 0],
    ['data', 'Data', <DataTab d={d} />, !editing && c.stage !== 'suggestion'],
    ['terms', 'Approved terms', <TermsTab d={d} />, !editing && hasTerms(d)],
    ['rev', 'Reviews and decisions', <Reviews d={d} />, hasReviews(d, me.role)],
    ['act', 'Activity', <Activity d={d} />, true],
    ['mail', `Emails (${(c.outbox || []).length})`, <MailList mails={(c.outbox || []).map((m: Dict) => ({ ...m, ref: { id: c.id, title: c.title } })).reverse()} />, true],
  ];
  const tabs = all.filter(t => t[3]);
  const cur = tabs.some(t => t[0] === tab) ? tab : 'uc';
  // The rail shows the actions that move the case on; form and inline actions live on the page itself (build 27 railHtml).
  const buttons = d.actions.filter(a => !a.form && !a.inline && !a.hidden);
  const formActs = d.editable ? d.actions.filter(a => FORM_ACTIONS.has(a.id)) : [];
  const blocked = d.actions.find(a => a.blockedMsg);
  const stops = d.measures.filter((r: Dict) => r.state === 'stop' && ['pilot', 'production'].includes(c.stage));
  const gaps = preview?.submitGaps;

  return (
    <div>
      <BackLink />
      <div className="casehead">
        <div className="idrow"><span className="ucid mono">{c.id}</span><h1>{c.title}</h1><div className="hdr-r"><DueAlert row={d.row} /><TierGauge tier={c.tier} /></div></div>
        <Stepper c={c} />
      </div>
      <div className="caselayout">
        <div className="stack">
          {blocked && <div className="callout warn"><b>Training is needed before you can submit</b><span className="small">{blocked.blockedMsg} <a href="#/training">Open Training</a></span></div>}
          {c.returned && c.stage === 'use_case' && <div className="callout warn"><b>{c.returned.from === 'owner' ? 'The owner declined sign-off' : 'Returned for remediation (' + (RET_FROM[c.returned.from] || c.returned.from) + ')'}</b>
            {c.returned.from === 'triage' ? <ReasonList text={c.returned.reason} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{c.returned.reason}</span>}
            {c.returned.from === 'owner' && <span className="muted small">Update the draft and resubmit to the same owner.</span>}</div>}
          {c.stage === 'closed' && c.closed && <div className="callout bad"><b>{c.closed.notPermitted ? 'Closed and marked not permitted' : 'Closed with reason'} ({CLOSED_FROM[c.closed.from] || c.closed.from})</b><span>{c.closed.reason}</span>
            <span className="muted small">{c.closed.notPermitted ? 'It cannot return to the suggestion box unless the governance lead removes the "not permitted" mark.' : 'The submitter, the owner, the governance lead or an adviser can return it to the suggestion box.'}</span></div>}
          {c.signoff?.status === 'requested' && c.stage === 'use_case' && (me.id === c.signoff.ownerId
            ? <div className="callout"><b>{name(c.signoff.requestedBy)} asks you to sign off as owner</b><span>You can edit the draft below. Accepting submits it for triage and starts the review clock. Declining returns it to {name(c.submitterId)} with your reason, and the owner stays as you.</span></div>
            : <div className="callout"><b>Waiting for {name(c.signoff.ownerId)} to sign off</b><span>The draft is locked to the owner, who can edit it, accept it (which submits it for triage) or decline with a reason. The review clock has not started. {me.id === c.signoff.requestedBy || me.id === c.submitterId ? 'You can withdraw the request from the next-step panel.' : ''}</span></div>)}
          {d.budgetFlag && c.scoring && <div className="callout warn"><b>{ALERT} Budget scrutiny</b><span>The ongoing cost is {money(d.budgetFlag.amount)} per user per month, above the {money(d.budgetFlag.limit)} limit. This does not stop or score the case. Reviewers should confirm the budget ({c.form?.budgetSource || 'not named'}) and the return on investment with the owner.</span></div>}
          {stops.map((r: Dict) => <div key={r.m.id || r.m.name} className="callout bad"><b>{ALERT} Stop limit passed: {r.m.name}</b>
            <span>Latest result: <b>{r.value}</b> (recorded {fdateShort(r.at)}). Stop limit: <b>{r.m.stop}</b>. {r.m.dir === 'lower' ? 'Lower is better, so the result is above the limit.' : 'Higher is better, so the result is below the limit.'}</span>
            <span>The governance lead has been alerted. Nothing was stopped or sent back automatically: the lead decides whether to rework, reassess or reject.</span></div>)}
          {d.row.acceptanceExpired && <div className="callout warn"><b>{ALERT} Acceptance expired</b><span>The approval was valid until {fdate(c.acceptance?.validUntil)}. It is in the governance lead's queue to be renewed or reassessed. For a critical case the lead can take the decision to the executives.</span></div>}
          {showGaps && gaps?.count > 0 && <div className="callout warn"><b>Still to answer before you submit</b>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{[...gaps.fields, ...gaps.questions.map((q: Dict) => q.text), ...gaps.readiness.map((r: Dict) => r.text)].map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>}
          <div>
            <div className="tabs" role="tablist" aria-label="Use case sections">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={k === cur} onClick={() => setTab(k)}>{l}</button>)}</div>
            <div className="stack">{tabs.find(t => t[0] === cur)?.[2]}</div>
          </div>
          <p className="small muted">{(c.outbox || []).length} simulated message{(c.outbox || []).length === 1 ? '' : 's'} for this case. <a href={'#/outbox'} onClick={e => { e.preventDefault(); setTab('mail'); }}>View the emails</a></p>
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
              <button className={'btn ' + (a.tone === 'danger' ? 'stop' : a.tone || '')} aria-disabled={a.disabled || undefined} onClick={() => openAction(a)}>{a.label}</button>
              {a.disabled && a.why && <p className="why">{a.why}</p>}</div>)}</div>
              : !formActs.length && <WaitingOn d={d} />}
          </div>
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
      {open && <ActionDialog caseId={c.id} action={open} extra={openExtra} onClose={() => setOpen(null)} onDone={done}
        draftAction={open.canDraft || open.id === 'rv_vote' ? d.actions.find(a => a.id === 'review_draft') : undefined} />}
      {evidence !== false && <EvidenceDialog d={d} controlId={evidence || undefined} onClose={() => setEvidence(false)} onDone={done} />}
      {soft && <Backdrop onClose={() => setSoft(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="Before you submit">
        <div className="phead"><h2>Before you submit</h2></div><div className="pbody">
          {soft.noConf.length > 0 && <><p className="small" style={{ margin: '6px 0 2px' }}><b>No one is named to confirm these controls.</b> A control counts as supported when a named person confirms it or when you attach evidence.</p>
            <ul className="small">{soft.noConf.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
          {soft.unclaimed.length > 0 && <><p className="small" style={{ margin: '6px 0 2px' }}><b>Recommended controls you have not claimed.</b> Add them if they apply.</p>
            <ul className="small">{soft.unclaimed.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
          <p className="small muted">You can still submit as it is.</p></div>
        <div className="pfoot"><button className="btn primary" onClick={() => { const a = soft.from; setSoft(null); setSoftOk(true); formAction(a, false, true); }}>Submit anyway</button>
          <button className="btn ghost" onClick={() => { setSoft(null); setTab('uc'); setJump(j => ({ k: 'controls', n: (j?.n || 0) + 1 })); }}>Go back and name confirmers</button></div></div></Backdrop>}
      {ipAsk && <Backdrop onClose={() => setIpAsk(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="Intellectual property acknowledgment">
        <div className="phead"><h2>Intellectual property acknowledgment</h2></div><div className="pbody"><p>{IP_TEXT}</p><p className="small muted" style={{ marginTop: 6 }}>Your acknowledgment is recorded on the use case. It does not affect scoring.</p></div>
        <div className="pfoot"><button className="btn primary" onClick={() => { const a = ipAsk; setIpAsk(null); formAction(a, true); }}>I acknowledge</button>
          <button className="btn ghost" onClick={() => setIpAsk(null)}>Cancel</button></div></div></Backdrop>}
    </div>
  );
}

/** Stage chevrons. Executive review shows only for Critical cases; a closed case ends in a red stage. JavaScript stepper. */
function Stepper({ c }: { c: Dict }) {
  const { boot } = useApp();
  const showExec = c.tier === 'critical' || c.execDecision || c.stage === 'exec';
  const steps = STEPS.filter(s => s !== 'exec' || showExec);
  const cur = c.stage === 'closed' ? (c.closed?.from === 'monitoring' ? 'production' : STEPS.includes(c.closed?.from) ? c.closed.from : 'panel') : c.stage;
  const ci = steps.indexOf(cur);
  return (
    <div className="tracker" role="list" aria-label="Progress">{steps.map((s, i) => {
      let cl = i < ci ? 'done' : i === ci ? (c.stage === 'closed' ? 'end' : 'now') : '';
      if (s === 'pilot' && c.pilot?.waived && i < ci) cl = 'skip';
      return <div key={s} className={'s ' + cl} role="listitem" aria-current={i === ci ? 'step' : undefined}>{boot.stageLabels[s]}</div>;
    })}</div>
  );
}

/** Triage reasons as a list, with red GUARDRAIL and amber MISSING INFORMATION tags. JavaScript reasonList. */
function ReasonList({ text }: { text: string }) {
  const parts = String(text || '').split(/(?=Guardrail: |Missing information: |Data readiness: )/).map(x => x.trim()).filter(Boolean);
  return <ul className="reasons">{parts.map((r, i) => {
    const m = /^(Guardrail|Missing information|Data readiness): ?([\s\S]*)$/.exec(r);
    const k = m ? (m[1] === 'Guardrail' ? 'gate' : m[1] === 'Missing information' ? 'miss' : '') : '';
    return <li key={i}>{m && <><span className={'rpre ' + k}>{m[1]}</span> </>}{m ? m[2] : r}</li>;
  })}</ul>;
}

const BackLink = () => <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => go('cases')}>&larr; Back to use cases</button>;

/** Who the case is waiting for, when the viewer has nothing to do. Port of build 27's waitingOn (short form). */
function WaitingOn({ d }: { d: CaseDetail }) {
  const { me, name } = useApp();
  if (me.role === 'auditor') return <p className="muted">Read-only access. The auditor can see every case, decision and audit entry but takes no action.</p>;
  if (me.role === 'admin') return <p className="muted">The demo admin only manages rules and data.</p>;
  return <p className="muted">Nothing for {me.name} to do on this case.{d.waitingOn.length ? <> Waiting for <b>{d.waitingOn.map(name).join(', ')}</b>. Use "Viewing as" at the top to switch to them.</> : null}</p>;
}
