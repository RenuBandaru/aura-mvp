// Add evidence for a claimed control: a link, or a small file. Port of build 27's evidenceModal.
// The file is read in the browser and sent to the API, which stores it with the case.

import { useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import type { CaseDetail, Dict } from '../types';
import { Backdrop } from './bits';

const EVIDENCE_MAX = 500 * 1024, EVIDENCE_TYPES = 'pdf, png, jpg, gif, webp, txt, md, json, csv, docx, xlsx, pptx, zip';
const EVIDENCE_EXT = /\.(pdf|png|jpe?g|gif|webp|txt|md|json|csv|docx|xlsx|pptx|zip)$/i;
const kb = (n: number) => (n < 1024 ? n + ' bytes' : Math.round(n / 1024) + ' KB');

export function EvidenceDialog({ d, controlId: initial, onClose, onDone, before }: {
  d: CaseDetail; controlId?: string; onClose: () => void; onDone: (d: CaseDetail) => void;
  /** Run first, for example to save the draft so the evidence lands on the case as it is being edited. */
  before?: () => Promise<void>;
}) {
  const { boot, toast } = useApp();
  const claimed: string[] = d.case.form?.controls || [];
  const [controlId, setControlId] = useState(initial || claimed[0] || '');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const k = (boot.rules.controls || []).find((x: Dict) => x.id === controlId);

  const send = async () => {
    const u = url.trim();
    if (!u && !file) { toast('Add a link or choose a file.', true); return; }
    if (file && file.size > EVIDENCE_MAX) { toast('That file is ' + kb(file.size) + '. The limit is ' + Math.round(EVIDENCE_MAX / 1024) + ' KB.', true); return; }
    if (file && !EVIDENCE_EXT.test(file.name)) { toast('This file type is not accepted. Use one of: ' + EVIDENCE_TYPES + '.', true); return; }
    const input: Dict = { controlId, note };
    if (file) input.upload = { name: file.name, type: file.type, dataUrl: await readAsDataUrl(file) };
    else input.url = u;
    try {
      if (before) await before();
      const r = await post<CaseDetail>(`/cases/${d.case.id}/actions/add_evidence`, { input });
      toast('Evidence added.');
      onDone(r);
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="modal plain" role="dialog" aria-modal="true" aria-label="Add evidence">
        <h3>Add evidence</h3>
        {initial ? <p className="small"><b>{k?.text || controlId}</b></p>
          : <div className="field"><label htmlFor="ev_ctl">Control</label><select id="ev_ctl" value={controlId} onChange={e => setControlId(e.target.value)}>
            {claimed.map(id => <option key={id} value={id}>{(boot.rules.controls.find((x: Dict) => x.id === id) || {}).text || id}</option>)}</select></div>}
        <p className="small muted" style={{ margin: '4px 0 8px' }}>A link, or a small file up to {Math.round(EVIDENCE_MAX / 1024)} KB ({EVIDENCE_TYPES}). Evidence is separate from a confirmation: neither replaces the other. Everyone who can see this case can see it.</p>
        <div className="formgrid">
          <div className="field"><label htmlFor="ev_url">Link</label><input type="text" id="ev_url" placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} /></div>
          <div className="field"><label htmlFor="ev_file">or a file</label><input type="file" id="ev_file" onChange={e => setFile(e.target.files?.[0] || null)} /></div>
          <div className="field"><label htmlFor="ev_note">Note (optional)</label><input type="text" id="ev_note" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={!controlId} onClick={send}>Add evidence</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Backdrop>
  );
}

const readAsDataUrl = (f: File) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => fail(new Error('The file could not be read.'));
  r.readAsDataURL(f);
});
