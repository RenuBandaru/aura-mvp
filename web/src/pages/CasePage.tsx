// One use case: its header and stage, the sections in tabs, and the "Next step" rail with every action
// the person you are viewing as can take. Port of build 27's vCase and railHtml.
//
// Flow: load the case page from the API (which runs actions_for for this person), show the actions as
// buttons, open a dialog for the one picked, send it, and replace the page with what the API returns.

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { Action, CaseDetail, Dict } from '../types';
import { fdateShort, money, fdateY } from '../format';
import { DueAlert, TierGauge, useLoad, Backdrop, ALERT, HELP_ICO } from '../components/bits';
import { ActionDialog } from '../components/ActionDialog';
import { EvidenceDialog } from '../components/EvidenceDialog';
import { FormEditor, draftFrom, DraftForm } from '../components/FormEditor';
import { Activity, Assessment, Briefing, ControlsEvidence, DataTab, Reviews, TermsTab, UseCaseView, hasAssessment, hasReviews, hasTerms } from '../components/CaseSections';
import { MailList } from '../components/MailList';
import { MatchCard, matchTerms } from '../components/MatchCard';

const IP_TEXT = 'All AI models, datasets and outputs this use case produces are to be treated as corporate intellectual property, as the AI governance policy requires.';
const STEPS = ['suggestion', 'use_case', 'vetting', 'panel', 'exec', 'pilot', 'production'];
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
  const [, setPreview] = useState<Dict | null>(null);
  const [ipAsk, setIpAsk] = useState<string | null>(null); // the form action waiting for the IP acknowledgement
  const [showGaps, setShowGaps] = useState(false);
  // Build 27's soft check before submitting (the API's softGaps): claimed controls nobody confirms, recommended controls not claimed.
  const [soft, setSoft] = useState<{ from: string; noConf: string[]; unclaimed: string[] } | null>(null);
  const [softOk, setSoftOk] = useState(false); // "Submit anyway" was chosen, so do not ask again on this page
  const [req, setReq] = useState<Dict[] | null>(null); // confirmation requests waiting to be approved
  const [exSol, setExSol] = useState<{ note: string; ms: Dict[] } | null>(null);
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
      if (p.submitGaps?.count) {
        setShowGaps(true); setTab('uc');
        const first = (['about', 'cost', 'measures', 'risk', 'ready', 'controls'] as const).find(k => p.sectionGaps?.[k]);
        if (first) setJump(j => ({ k: first, n: (j?.n || 0) + 1 }));
        window.setTimeout(() => document.getElementById('needbox')?.scrollIntoView({ block: 'center' }), 50);
        toast('Some answers are still missing. They are listed on the form.', true); return;
      }
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
  /** "Send confirmation requests...": who would be emailed, before anything is sent. Build 27's ucrequest. */
  const askConfirmations = () => {
    if (!draft) return;
    const items = (draft.controls || []).filter((cid: string) => draft.attesters?.[cid]).map((cid: string) => {
      const pid = draft.attesters[cid], k = (boot.rules.controls || []).find((x: Dict) => x.id === cid), old = (c.attestations || []).find((a: Dict) => a.controlId === cid);
      return { cid, text: k ? k.text : cid, pid, already: !!(old && old.personId === pid) };
    });
    if (!items.length) { toast('Name a confirmer on at least one claimed control first.', true); return; }
    if (!items.some((i: Dict) => !i.already)) { toast('Everyone you named has already been asked.'); return; }
    setReq(items);
  };
  const sendConfirmations = async () => {
    try { done(await post<CaseDetail>(`/cases/${c.id}/actions/request_confirmations`, { input: { form: draft } })); setReq(null); toast('Confirmation requests sent.'); }
    catch (e: any) { toast(e.message, true); }
  };
  /** "Existing solutions": tools and use cases close to the draft, or the approved tools when nothing matches. Build 27's exsol. */
  const existing = async () => {
    const q = [draft?.problem, draft?.solution, c.title, c.idea].filter(Boolean).join(' ');
    try {
      let ms = matchTerms(q).length ? await get<Dict[]>('/similar?text=' + encodeURIComponent(q) + '&exclude=' + c.id) : [];
      let note = 'These are close to what you described. They are for your information only: you are not asked to respond to them. If an existing option falls short, say why in Alternatives considered.';
      if (!ms.length) {
        ms = (await get<Dict[]>('/tools')).filter(t => t.status === 'approved').map(t => ({ kind: 'tool', ref: t, words: [] }));
        note = 'Nothing matched your description, so these are the approved AI tools. They are for your information only.';
      }
      setExSol({ note, ms });
    } catch (e: any) { toast(e.message, true); }
  };
  /** Save the draft before adding evidence from the form, so nothing typed is lost (build 27's evopen). */
  const saveFirst = async () => { if (draft && d.editable) await post<CaseDetail>(`/cases/${c.id}/actions/save_draft`, { input: { form: draft } }); };
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
    ['uc', 'Use case', editing ? <FormEditor d={d} form={draft!} setForm={setDraft} onPreview={setPreview} unitId={c.unitId}
      accepting={d.actions.some(a => a.id === 'signoff_accept')} returned={!!c.returned} jump={jump} showNeed={showGaps}
      onEvidence={id => setEvidence(id)} onRemoveEvidence={removeEvidence} onRequest={askConfirmations} onExisting={existing} /> : <UseCaseView d={d} />, true],
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
          {d.row.acceptanceExpired && <div className="callout warn"><b>{ALERT} Acceptance expired</b><span>The approval was valid until {fdateY(c.acceptance?.validUntil)}. It is in the governance lead's queue to be renewed or reassessed. For a critical case the lead can take the decision to the executives.</span></div>}
          <div>
            <div className="tabs" role="tablist" aria-label="Use case sections">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={k === cur} onClick={() => setTab(k)}>{l}</button>)}</div>
            <div className="stack">{tabs.find(t => t[0] === cur)?.[2]}</div>
          </div>
          <p className="small muted">{(c.outbox || []).length} simulated message{(c.outbox || []).length === 1 ? '' : 's'} for this case. <a href={'#/outbox/' + c.id}>View in outbox</a></p>
        </div>
        <aside className="rail" aria-label="Actions and facts">
          <div className="card"><h2>Next step</h2>
            {formActs.length > 0 && <div className="actions" style={{ marginBottom: 10 }}>
              <p className="muted small">Complete the use case form on this page, then use these buttons.</p>
              {formActs.filter(a => a.id !== 'save_draft').map(a => <button key={a.id} className="btn primary" onClick={() => formAction(a.id)}>
                {a.id === 'signoff_accept' ? 'Accept and submit for triage' : (c.form?.ownerId || c.submitterId) === me.id || draft?.ownerId === me.id ? 'Submit for triage' : 'Request owner sign-off'}</button>)}
              {formActs.some(a => a.id === 'save_draft') && <button className="btn" onClick={() => formAction('save_draft')}>Save draft</button>}
            </div>}
            {buttons.length ? <div className="actions">{buttons.map(a => <div key={a.id}>
              <button className={'btn ' + (a.tone === 'danger' ? 'stop' : a.tone || '')} aria-disabled={a.disabled || undefined} onClick={() => openAction(a)}>{a.id === 'ask_adviser' && HELP_ICO}{a.label}</button>
              {a.disabled && a.why && <p className="why">{a.why}</p>}
              {a.id === 'ask_adviser' && (c.helpRequests || []).some((h: Dict) => h.status === 'open') && <p className="muted small">Help requested. Your adviser has it in their queue.</p>}</div>)}</div>
              : !formActs.length && <WaitingOn d={d} />}
          </div>
          <div className="card"><h2>Facts</h2><dl className="facts">
            <dt>Stage</dt><dd>{boot.stageLabels[c.stage]}</dd>
            <dt>Submitter</dt><dd>{name(c.submitterId)}</dd>
            {c.form?.ownerId && <><dt>Owner</dt><dd>{name(c.form.ownerId)}</dd></>}
            {c.adviserId && <><dt>Adviser</dt><dd>{name(c.adviserId)}</dd></>}
            {c.dueAt && c.stage !== 'closed' && <><dt>Due</dt><dd>{fdateY(c.dueAt)}</dd></>}
            <dt>Logged</dt><dd>{fdateY(c.createdAt)}</dd>
            {d.waitingOn.length > 0 && <><dt>Waiting for</dt><dd className="small">{d.waitingOn.map(name).join(', ')}</dd></>}
          </dl></div>
        </aside>
      </div>
      {open && <ActionDialog caseId={c.id} action={open} extra={openExtra} onClose={() => setOpen(null)} onDone={done}
        draftAction={open.canDraft || open.id === 'rv_vote' ? d.actions.find(a => a.id === 'review_draft') : undefined} />}
      {evidence !== false && <EvidenceDialog d={d} controlId={evidence || undefined} onClose={() => setEvidence(false)} before={editing ? saveFirst : undefined}
        onDone={done} />}
      {req && <ReqModal items={req} onSend={sendConfirmations} onClose={() => setReq(null)} />}
      {exSol && <Backdrop onClose={() => setExSol(null)}><div className="modal plain" role="dialog" aria-modal="true" aria-label="Existing solutions"><h3>Existing solutions</h3>
        <p className="small muted" style={{ margin: '4px 0 8px' }}>{exSol.note}</p>
        {exSol.ms.length ? exSol.ms.map((m, i) => <MatchCard key={i} m={m} />) : <p className="muted small">No AI tools are in the catalog yet.</p>}
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => setExSol(null)}>Close</button></div></div></Backdrop>}
      {soft && <Backdrop onClose={() => setSoft(null)}><div className="modal plain" role="dialog" aria-modal="true" aria-label="Before you submit"><h3>Before you submit</h3>
        {soft.noConf.length > 0 && <><p className="small" style={{ margin: '6px 0 2px' }}><b>No one is named to confirm these controls.</b> A control counts as supported when a named person confirms it or when you attach evidence.</p>
          <ul className="small">{soft.noConf.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
        {soft.unclaimed.length > 0 && <><p className="small" style={{ margin: '6px 0 2px' }}><b>Recommended controls you have not claimed.</b> Add them if they apply.</p>
          <ul className="small">{soft.unclaimed.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
        <p className="small muted">You can still submit as it is.</p>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => { const a = soft.from; setSoft(null); setSoftOk(true); formAction(a, false, true); }}>Submit anyway</button>
          <button className="btn ghost" onClick={() => { setSoft(null); setTab('uc'); setJump(j => ({ k: 'controls', n: (j?.n || 0) + 1 })); }}>Go back and name confirmers</button></div></div></Backdrop>}
      {ipAsk && <Backdrop onClose={() => setIpAsk(null)}><div className="modal plain" role="dialog" aria-modal="true" aria-label="Intellectual property acknowledgment"><h3>Intellectual property acknowledgment</h3>
        <p>{IP_TEXT}</p><p className="small muted">Your acknowledgment is recorded on the use case. It does not affect scoring.</p>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => { const a = ipAsk; setIpAsk(null); formAction(a, true); }}>I acknowledge</button>
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

/** Who the case is waiting for, when the viewer has nothing to do. Build 27's waitingOn. */
function WaitingOn({ d }: { d: CaseDetail }) {
  const { me, name, boot } = useApp();
  const c = d.case;
  if (me.role === 'auditor') return <p className="muted">Read-only access. The auditor can see every case, decision and audit entry but takes no action.</p>;
  if (me.role === 'admin') return <p className="muted">The demo admin only manages rules and data.</p>;
  if (d.dutyBlock) return <p className="muted">{d.dutyBlock} Another reviewer takes this one.</p>;
  const sub = name(c.submitterId), own = name(c.form?.ownerId || c.submitterId), lead = boot.people.find(p => p.role === 'lead')?.name || '';
  const sw = ' Use the Viewing as menu at the top to switch to them.';
  let t: React.ReactNode;
  if (c.stage === 'suggestion') t = <>This is a suggestion. Waiting for <b>{sub}</b> or an adoption adviser to develop it into a use case.</>;
  else if (c.stage === 'use_case') t = c.signoff?.status === 'requested' ? <>Waiting for <b>{own}</b> to sign off as owner, edit the draft and submit it for triage.</>
    : c.returned ? <>This case was returned{c.returned.from === 'triage' ? ' by triage' : c.returned.from === 'owner' ? ' by the owner' : ' for remediation'}. Waiting for <b>{sub}</b>, the submitter, to update the details and resubmit.</>
    : <>Still being drafted. Waiting for <b>{sub}</b> to complete the details and submit for triage.</>;
  else if (c.stage === 'vetting') t = <>Waiting for the governance lead (<b>{lead}</b>) to vet this case.</>;
  else if (c.stage === 'panel') t = 'Waiting for the standing panel to review it.';
  else if (c.stage === 'exec') t = 'Waiting for the executives to decide.';
  else if (c.stage === 'pilot' || c.stage === 'production') t = <>Nothing is due from {me.name}. The governance lead (<b>{lead}</b>) handles reviews and measurements for this stage.</>;
  else if (c.stage === 'closed') t = c.closed?.notPermitted ? 'This case is closed and marked not permitted. It cannot return to the suggestion box unless the governance lead removes the mark.'
    : <>This case is closed. <b>{sub}</b>, the owner, the governance lead or an adviser can return it to the suggestion box.</>;
  else t = 'Nothing for ' + me.name + ' to do on this case.';
  return <p className="muted">{t}{['pilot', 'production', 'closed'].includes(c.stage) ? '' : sw}</p>;
}

/** Who would be emailed for confirmation, before anything is sent. Build 27's reqModal. */
function ReqModal({ items, onSend, onClose }: { items: Dict[]; onSend: () => void; onClose: () => void }) {
  const { name, boot } = useApp();
  const by: Record<string, Dict[]> = {};
  items.forEach(i => { (by[i.pid] = by[i.pid] || []).push(i); });
  const ids = Object.keys(by), fresh = ids.filter(p => by[p].some(i => !i.already));
  return <Backdrop onClose={onClose}><div className="modal plain" role="dialog" aria-modal="true" aria-label="Send confirmation requests"><h3>Send confirmation requests</h3>
    <p className="small muted" style={{ margin: '4px 0 8px' }}>These people will each receive an email (simulated in this prototype) asking them to confirm the controls below. They can respond any time before approval. People already asked are shown faded and get no new email.</p>
    <div className="reqlist">{ids.slice().sort((a, b) => (fresh.includes(b) ? 1 : 0) - (fresh.includes(a) ? 1 : 0)).map(p => <div key={p} className={'reqp ' + (fresh.includes(p) ? 'fresh' : 'old')}>
      <div><b>{name(p)}</b> <span className="muted small">{boot.people.find(x => x.id === p)?.title || ''}</span> {fresh.includes(p) ? <span className="chip ok">Will get an email</span> : <span className="chip">Already asked, no new email</span>}</div>
      <ul className="small">{by[p].map((i, n) => <li key={n}>{i.text}{i.already && <span className="muted"> (already asked, no new email)</span>}</li>)}</ul></div>)}</div>
    <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={onSend}>Send {fresh.length} email{fresh.length === 1 ? '' : 's'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></div></div></Backdrop>;
}
