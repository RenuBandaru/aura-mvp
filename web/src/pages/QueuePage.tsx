// "Your queue": the cases waiting for the person you are viewing as. Port of build 27's vQueue.

import { get } from '../api';
import { go, useApp } from '../state';
import type { CaseRow, QueueItem } from '../types';
import { CaseTable, DueText, GapChips, PageHead, TierChip, useLoad } from '../components/bits';

export function QueuePage() {
  const { me, version } = useApp();
  const { data, error } = useLoad(() => get<{ items: QueueItem[]; mine: CaseRow[]; advised: CaseRow[] }>('/queue'), [me.id, version]);
  if (me.role === 'admin') {
    return <><PageHead title="Queue" sub="The demo admin does not act on cases." />
      <div className="empty"><p>Use "Viewing as" at the top to act as a submitter, the governance lead, an expert or an executive.</p><button className="btn primary" onClick={() => go('cases')}>See all use cases</button></div></>;
  }
  if (error) return <div className="callout bad">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <>
      <PageHead title="Your queue" sub={`${me.name}, ${me.roleLabel.toLowerCase()}`}>
        {me.role !== 'auditor' && <button className="btn accent" onClick={() => go('new')}>New suggestion</button>}
      </PageHead>
      <div className="stack">
        {data.items.length ? (
          <div className="stack" style={{ gap: 8 }} aria-label="Waiting for you">
            {data.items.map(i => (
              <div key={i.id} className={'qitem' + (i.late ? ' late' : '')} role="button" tabIndex={0}
                onClick={() => go('case', i.id)} onKeyDown={e => e.key === 'Enter' && go('case', i.id)}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span><span className="mono muted">{i.id}</span> <span className="title">{i.title}</span></span>
                  <span className="row"><DueText row={i} />{i.returned && <span className="chip warn">Returned</span>}<GapChips row={i} />
                    {i.readyToFinalize && <span className="chip ok">Ready to finalize</span>}{i.deadlock && <span className="chip bad">Deadlock</span>}</span>
                </div>
                <div className="row small"><b>{i.stageLabel}</b><TierChip tier={i.tier} label={i.tierLabel} /><span className="muted">{i.why}</span></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty"><b>Nothing is waiting for you.</b><span className="muted">When a case needs your action it appears here.</span>
            <button className="btn" onClick={() => go('cases')}>Browse all use cases</button></div>
        )}
        {data.advised.length > 0 && <div><h2 style={{ marginBottom: 8 }}>Other cases you advise</h2><CaseTable rows={data.advised} onOpen={id => go('case', id)} /></div>}
        {data.mine.length > 0 && <div><h2 style={{ marginBottom: 8 }}>Your other submissions</h2><CaseTable rows={data.mine} onOpen={id => go('case', id)} /></div>}
      </div>
    </>
  );
}
