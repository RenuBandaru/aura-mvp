// Add evidence for a claimed control: a link, or a small file. Port of build 27's evidenceModal.
// The file is read in the browser and sent to the API, which stores it with the case.

import { useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import type { CaseDetail, Dict } from '../types';

export function EvidenceDialog({ d, onClose, onDone }: { d: CaseDetail; onClose: () => void; onDone: (d: CaseDetail) => void }) {
  const { boot, toast } = useApp();
  const claimed: string[] = d.case.form?.controls || [];
  const [controlId, setControlId] = useState(claimed[0] || '');
  const [kind, setKind] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const send = async () => {
    setError('');
    const input: Dict = { controlId, note };
    if (kind === 'link') input.url = url;
    else if (file) input.upload = { name: file.name, type: file.type, dataUrl: await readAsDataUrl(file) };
    try {
      const r = await post<CaseDetail>(`/cases/${d.case.id}/actions/add_evidence`, { input });
      toast('Evidence added.');
      onDone(r);
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="modalbg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add evidence">
        <div className="phead"><h2>Add evidence</h2><button className="pclose" onClick={onClose} aria-label="Close">&times;</button></div>
        <div className="pbody">
          {!claimed.length && <p className="callout warn">Claim a control on the form first. Evidence supports a claimed control.</p>}
          <div className="field"><label htmlFor="ev_ctl">Control</label><select id="ev_ctl" value={controlId} onChange={e => setControlId(e.target.value)}>
            {claimed.map(id => <option key={id} value={id}>{(boot.rules.controls.find((k: Dict) => k.id === id) || {}).text || id}</option>)}</select></div>
          <div className="row" style={{ marginBottom: 10 }}>
            <label><input type="radio" checked={kind === 'link'} onChange={() => setKind('link')} /> A link</label>
            <label><input type="radio" checked={kind === 'file'} onChange={() => setKind('file')} /> A file (up to 500 KB)</label></div>
          {kind === 'link' ? <div className="field"><label htmlFor="ev_url">Link</label><input id="ev_url" type="url" placeholder="https://" value={url} onChange={e => setUrl(e.target.value)} /></div>
            : <div className="field"><label htmlFor="ev_file">File</label><input id="ev_file" type="file" onChange={e => setFile(e.target.files?.[0] || null)} /></div>}
          <div className="field"><label htmlFor="ev_note">Note (optional)</label><textarea id="ev_note" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <div className="pfoot"><button className="btn primary" disabled={!controlId} onClick={send}>Add evidence</button><button className="btn ghost" onClick={onClose}>Cancel</button>
          {error && <span className="err" role="alert">{error}</span>}</div>
      </div>
    </div>
  );
}

const readAsDataUrl = (f: File) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => fail(new Error('The file could not be read.'));
  r.readAsDataURL(f);
});
