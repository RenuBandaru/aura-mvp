const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('eng.js','utf8').split('\n').filter(l=>!/^\s*export /.test(l)).join('\n');
const ctx={console,TextEncoder,Date,JSON,Math,Set,Map}; vm.createContext(ctx);
vm.runInContext(src+'\nthis.__x={defaultRules,controlNeeds,runScoring,runTriage,buildSeed,actionsFor,perform,PEOPLE,byId,clone,supportView};',ctx);
const X=ctx.__x, R=X.defaultRules(), NOW=Date.now();
const seed=X.buildSeed(NOW); const cx={rules:R,now:NOW,rv:1};
const person=id=>X.PEOPLE.find(p=>p.id===id);
const fill=(a,extra)=>{ const inp={}; (a.fields||[]).forEach(f=>{
  if(f.type==='overrides'){ (f.threads||[]).forEach(t=>{inp['ov_'+t.slug]='accepted for test'; inp['ovc_'+t.slug]=true;}); return; }
  if(f.type==='measures'){inp[f.name]=f.value; return;}
  if(f.type==='checks'){inp[f.name]=f.value&&f.value.length?f.value:(f.options||[]).slice(0,2).map(o=>o.v); return;}
  if(f.type==='select'){inp[f.name]=f.value||((f.options||[]).find(o=>o.v)||{}).v; return;}
  if(f.type==='number'){inp[f.name]=f.value!=null&&f.value!==''?f.value:5; return;}
  if(f.type==='support'||f.type==='panelnotes'||f.type==='hidden'||f.type==='note'||!f.name) return;
  inp[f.name]=f.value||'test text'; });
  return Object.assign(inp,extra||{}); };
const get=id=>X.clone(seed.cases.find(c=>c.id===id));
const acts=(c,pid)=>X.actionsFor(c,person(pid),cx);
const names=(c,pid)=>acts(c,pid).map(a=>a.id+(a.disabled?'(off)':'')).join(', ');
const run=(c,pid,aid,extra)=>{ const a=acts(c,pid).find(x=>x.id===aid); if(!a) throw new Error('no action '+aid+' for '+pid+' have '+names(c,pid)); return X.perform(c,aid,fill(a,extra),person(pid),cx); };
const T=(n,f)=>{ try{ f(); console.log('PASS',n);}catch(e){console.log('FAIL',n,'->',e.message.slice(0,200));} };

// B-67
const vote=(c,pid,dec,str,text)=>run(c,pid,'rv_vote',{decision:dec,strength:str||'firm',text:text||'my note'});
T('B-67 vetting actions for low case',()=>{ const c=get('UC-1006'); c.tier='low'; const n=names(c,'p_elena'); console.log('   ',n); if(!/vet_to_panel/.test(n)||/vet_raise/.test(n)) throw new Error(n); });
T('B-67 low to panel needs a reason',()=>{ const c=get('UC-1006'); c.tier='low'; let threw=false; try{ X.perform(c,'vet_to_panel',{},person('p_elena'),cx);}catch(e){threw=true;} if(!threw) throw new Error('no error'); });
T('B-67 low to panel with reason keeps tier',()=>{ const c=get('UC-1006'); c.tier='low'; const r=run(c,'p_elena','vet_to_panel',{note:'second look wanted',raiseTo:''}); if(r.stage!=='panel'||r.tier!=='low') throw new Error(r.stage+r.tier); });
T('B-67 raise tier option',()=>{ const c=get('UC-1006'); const r=run(c,'p_elena','vet_to_panel',{note:'raise it',raiseTo:'critical'}); if(r.stage!=='panel'||r.tier!=='critical') throw new Error(r.stage+r.tier); });
T('B-67 quorum low = moderate',()=>{ const c=get('UC-1006'); c.tier='low'; let r=run(c,'p_elena','vet_to_panel',{note:'x',raiseTo:''}); r.consults=[]; r=vote(r,'p_elena','approve','firm'); if(acts(r,'p_elena').some(a=>a.id==='panel_approve')) throw new Error('one firm vote finalizes'); r=vote(r,'p_sam','approve','firm'); if(!acts(r,'p_sam').some(a=>a.id==='panel_approve')) throw new Error('two firm votes do not finalize: '+names(r,'p_sam')); });
// B-62 / B-55
const panelReady=(id,dec)=>{ let c=get(id); c.consults=[]; c.panelNotes=[]; c.votes=undefined; ['p_sam','p_naomi','p_elena'].forEach(p=>{ c=vote(c,p,dec||'approve','firm'); }); return c; };
const execReady=(c,dec)=>{ ['p_margaret','p_victor','p_ines'].forEach(p=>{ c=vote(c,p,dec,'firm'); }); return c; };
T('B-62 escalate high case',()=>{ const c=panelReady('UC-1012','escalate'); if(!/panel_escalate/.test(names(c,'p_elena'))) throw new Error(names(c,'p_elena')); const r=run(c,'p_elena','panel_escalate',{note:'worth exec attention'}); if(r.stage!=='exec'||r.tier!=='high') throw new Error(r.stage+r.tier); console.log('    exec actions:',names(r,'p_margaret')); });
T('B-62 escalate low case',()=>{ const c=panelReady('UC-1012','escalate'); c.tier='low'; const r=run(c,'p_elena','panel_escalate',{note:''}); if(r.stage!=='exec'||r.tier!=='low') throw new Error(r.stage+r.tier); });
T('B-55 exec waive pilot',()=>{ const c=panelReady('UC-1012','escalate'); let e=run(c,'p_elena','panel_escalate',{note:'go'}); e=execReady(e,'waive'); const r=run(e,'p_margaret','exec_waive',{waiver:'Low-risk rollout'}); if(r.stage!=='production'||!r.pilot.waived) throw new Error(r.stage); console.log('    ',r.audit[r.audit.length-1].action,'|',r.outbox[r.outbox.length-1].subject); });
T('B-55 exec waive on critical seed',()=>{ let c=execReady(get('UC-1007'),'waive'); const r=run(c,'p_margaret','exec_waive',{waiver:'Reason'}); if(r.stage!=='production') throw new Error(r.stage); });
T('B-55 exec waive quorum (three executives)',()=>{ let c=vote(get('UC-1007'),'p_margaret','waive','firm'); c=vote(c,'p_victor','waive','firm'); if(acts(c,'p_victor').some(a=>a.id==='exec_waive')) throw new Error('two firm executives finalize'); c=vote(c,'p_ines','waive','firm'); if(!acts(c,'p_ines').some(a=>a.id==='exec_waive')) throw new Error('three firm executives do not finalize'); });
// B-68
T('B-68 exec note then edit',()=>{ let c=get('UC-1007'); c=vote(c,'p_margaret','approve','leaning','first'); if(c.stage!=='exec') throw new Error(c.stage); const lab=acts(c,'p_margaret').find(a=>a.id==='rv_vote').label; c=vote(c,'p_margaret','remediate','leaning','second'); const mine=c.panelNotes.filter(n=>n.by==='p_margaret'); if(lab!=='Change my decision'||mine.length!==1||mine[0].text!=='second') throw new Error(lab+mine.length); });
T('B-68 panel note label',()=>{ let c=get('UC-1012'); c.consults=[]; c.panelNotes=[]; c.votes=undefined; const l0=acts(c,'p_sam').find(a=>a.id==='rv_vote').label; c=vote(c,'p_sam','approve','leaning','a'); const lab=acts(c,'p_sam').find(a=>a.id==='rv_vote').label; if(l0!=='Record my decision'||lab!=='Change my decision') throw new Error(l0+'/'+lab); });
// B-72
T('B-72 auditor has no actions',()=>{ seed.cases.forEach(c=>{ const a=acts(c,'p_auditor'); if(a.length) throw new Error(c.id+': '+a.map(x=>x.id)); }); });
// ---- patch3 tests
T('B-63 notice on panel approve',()=>{ const c=panelReady('UC-1012','approve'); const before=c.outbox.length; const r=run(c,'p_elena','panel_approve',{}); const m=r.outbox.slice(before).filter(x=>/^Approval notice/.test(x.subject)); if(m.length!==1||r.outbox.length-before!==1) throw new Error('new mails '+(r.outbox.length-before)+' notices '+m.length); console.log('    --- notice body ---\n'+m[0].body.split('\n').map(l=>'    '+l.slice(0,220)).join('\n')); console.log('    to:',m[0].to.join(',')); });
T('B-63 notice on vetting approve',()=>{ const c=get('UC-1006'); c.tier='low'; const r=run(c,'p_elena','vet_approve',{}); const m=r.outbox.filter(x=>/^Approval notice/.test(x.subject)); if(m.length!==1) throw new Error('n='+m.length); if(!/Next review/.test(m[0].body)) throw new Error('no next review'); });
T('B-63 notice on panel waive',()=>{ const c=panelReady('UC-1012','waive'); const before=c.outbox.length; const r=run(c,'p_elena','panel_waive',{}); const m=r.outbox.slice(before).filter(x=>/^Approval notice/.test(x.subject)); if(m.length!==1||!/Pilot: waived/.test(m[0].body)||!/Next review/.test(m[0].body)) throw new Error(m.length); });
T('B-63 notice on exec approve + waive',()=>{ const r=run(execReady(get('UC-1007'),'approve'),'p_margaret','exec_approve',{}); if(r.outbox.filter(x=>/^Approval notice/.test(x.subject)).length!==1) throw new Error('approve'); const r2=run(execReady(get('UC-1007'),'waive'),'p_margaret','exec_waive',{waiver:'rr'}); if(r2.outbox.filter(x=>/^Approval notice/.test(x.subject)).length!==1) throw new Error('waive'); });
T('B-64 estimate in scoring notice',()=>{ const c=get('UC-1008'); const r=run(c,'p_dana','submit',{form:Object.assign(X.clone(c.form),{answers:Object.assign({},c.form.answers,{q_train:'no',q_sens:'int',q_svc:'co'})})}); const m=r.outbox.filter(x=>/under review/.test(x.subject)); console.log('    stage',r.stage,r.tier,'|',m.length&&m[0].body.split('\n')[1]); if(!m.length) throw new Error('no estimate mail ('+r.stage+')'); });
// B-70
T('B-70 reject not permitted + reopen rules',()=>{ let c=panelReady('UC-1012','reject'); c=run(c,'p_elena','panel_reject',{rationale:'We never allow this.',notPermitted:['np']}); if(c.stage!=='closed'||!c.closed.notPermitted) throw new Error('not marked');
  const sub=c.submitterId; if(/reopen/.test(names(c,sub))||/reopen/.test(names(c,c.adviserId))||/reopen/.test(names(c,'p_elena'))) throw new Error('reopen offered: '+names(c,'p_elena')); if(!/allow_again/.test(names(c,'p_elena'))) throw new Error('lead cannot undo'); if(/allow_again/.test(names(c,c.adviserId))) throw new Error('adviser can undo');
  c=run(c,'p_elena','allow_again',{note:'revisit'}); if(c.closed.notPermitted) throw new Error('still marked'); const who=['p_elena',c.adviserId,sub,'p_hannah'].map(id=>id+':'+/reopen/.test(names(c,id))); console.log('    reopen after undo:',who.join(' ')); if(!/reopen/.test(names(c,sub))||!/reopen/.test(names(c,c.adviserId))||!/reopen/.test(names(c,'p_elena'))) throw new Error('reopen missing'); });
T('B-70 plain reject can be reopened by owner/adviser/lead',()=>{ let c=panelReady('UC-1012','reject'); c=run(c,'p_elena','panel_reject',{rationale:'Not now.',notPermitted:[]}); if(c.closed.notPermitted) throw new Error('marked'); ['p_elena',c.adviserId,c.submitterId].forEach(id=>{ if(!/reopen/.test(names(c,id))) throw new Error(id); }); });
T('B-70 exec reject np flag',()=>{ let c=execReady(get('UC-1007'),'reject'); c=run(c,'p_margaret','exec_reject',{rationale:'No.',notPermitted:['np']}); if(!c.closed.notPermitted) throw new Error('flag'); });
T('B-70 pilot reject np flag',()=>{ let c=get('UC-1004'); c=run(c,'p_elena','pilot_reject',{note:'Bad.',notPermitted:['np']}); if(!c.closed.notPermitted) throw new Error('flag'); });
// guardrail wording
T('B-75 triage return text',()=>{ const c=get('UC-1008'); if(!/^Guardrail:/.test(c.returned.reason)||!/Resubmit when these are addressed\.$/.test(c.returned.reason)||/safety gate/i.test(c.returned.reason)) throw new Error(c.returned.reason); });
T('B-65 model type needs c_docs',()=>{ const n=X.controlNeeds({ucType:'model',answers:{},scope:'team',autonomy:'advice',controls:[]},R); if(n.c_docs.level!=='required') throw new Error(JSON.stringify(n.c_docs)); const n2=X.controlNeeds({ucType:'use',answers:{q_model:'yes'},scope:'team',autonomy:'advice',controls:[]},R); if(n2.c_docs.level!=='required') throw new Error('central yes'); const n3=X.controlNeeds({ucType:'use',answers:{q_model:'no'},scope:'team',autonomy:'advice',controls:[]},R); if(n3.c_docs.level) throw new Error('should be optional'); });
T('B-37 applicability',()=>{ const n=X.controlNeeds({ucType:'use',answers:{},scope:'team',autonomy:'advice',controls:[]},R); const ids=Object.keys(n); ['c_escalate','c_kill','c_bounds','c_validate','c_rollback','c_share'].forEach(i=>{ if(ids.includes(i)) throw new Error('offered '+i); }); const n2=X.controlNeeds({ucType:'use',answers:{},scope:'customer',autonomy:'automate',controls:[]},R); if(!n2.c_escalate||!n2.c_kill) throw new Error('missing when applicable'); console.log('    offered for plain case:',ids.join(',')); });
