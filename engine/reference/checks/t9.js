const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('eng.js','utf8').split('\n').filter(l=>!/^\s*export /.test(l)).join('\n');
const ctx={console,TextEncoder,Date,JSON,Math,Set,Map}; vm.createContext(ctx);
vm.runInContext(src+'\nthis.__x={defaultRules,buildSeed,actionsFor,perform,PEOPLE,byId,clone,revReady,revDeadlock,revBlockers,revQuorumWaivable,revReminderDue,revVotes,deadlockOptions,remindCase,termsNow,withRole};',ctx);
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
const T=(n,f)=>{ try{ f(); console.log('PASS',n);}catch(e){console.log('FAIL',n,'->',e.message.slice(0,300));} };
const vote=(c,pid,dec,str,text,extra)=>run(c,pid,'rv_vote',Object.assign({decision:dec,strength:str||'firm',text:text||'my note'},extra||{}));
const fresh=(id)=>{ const c=get(id||'UC-1012'); c.consults=[]; c.panelNotes=[]; c.votes=undefined; c.reviewDraft=null; return c; };
const throws=(f,re)=>{ try{f();}catch(e){ if(re&&!re.test(e.message)) throw new Error('wrong error: '+e.message); return; } throw new Error('did not throw'); };
const mailsTo=(c,n0,pid)=>c.outbox.slice(n0).filter(m=>m.to.includes(pid));
T('default exec quorum is 3',()=>{ if(R.execQuorum!==3) throw new Error(R.execQuorum); });
T('three executives exist and none is blocked on the Critical sample (UC-1007)',()=>{ const c=get('UC-1007'); const p=X.withRole('exec').map(x=>x.id); if(p.length<3) throw new Error(p.length); });
T('exec: 2 firm do not finalize, 3 do; a leaning third blocks',()=>{ let c=get('UC-1007'); c=vote(c,'p_margaret','approve'); c=vote(c,'p_victor','approve'); if(X.revReady(c,R)) throw new Error('ready at 2'); c=vote(c,'p_ines','approve','leaning'); if(X.revReady(c,R)) throw new Error('ready with a leaning third'); c=vote(c,'p_ines','approve'); const r=X.revReady(c,R); if(!r||r.N!==3||r.firm!==3) throw new Error(JSON.stringify(r)); });
T('exec: dissent among three is a deadlock any executive can break',()=>{ let c=get('UC-1007'); c=vote(c,'p_margaret','approve'); c=vote(c,'p_victor','approve'); c=vote(c,'p_ines','reject'); if(!X.revDeadlock(c,R,NOW)) throw new Error('no deadlock'); ['p_margaret','p_victor','p_ines'].forEach(p=>{ if(!acts(c,p).some(a=>a.id==='exec_break')) throw new Error(p+' cannot break'); }); });
T('panel moderate: two firm panel members finalize without the lead voting',()=>{ let c=fresh('UC-1012'); c.tier='moderate'; c=vote(c,'p_sam','approve'); c=vote(c,'p_naomi','approve'); const r=X.revReady(c,R); if(!r||!r.ok) throw new Error('not ready'); if(!acts(c,'p_elena').some(a=>a.id==='panel_approve')) throw new Error('lead cannot finalize: '+names(c,'p_elena')); });
T('panel: the lead can break a deadlock without having voted',()=>{ let c=fresh('UC-1012'); c.tier='moderate'; c=vote(c,'p_sam','approve'); c=vote(c,'p_naomi','remediate','leaning'); if(!acts(c,'p_elena').some(a=>a.id==='panel_break')) throw new Error('no break: '+names(c,'p_elena')); const r=run(c,'p_elena','panel_break',{outcome:'remediate',note:'Please address the concern.'}); if(r.stage==='panel') throw new Error('still in panel'); });
T('panel: the lead can waive the quorum without having voted',()=>{ let c=fresh('UC-1012'); const pool=X.withRole('panel').map(p=>p.id); const rest=pool.slice(1); c=vote(c,pool[0],'approve'); rest.forEach(p=>{ c=vote(c,p,'abstain','leaning',''); }); const w=X.revQuorumWaivable(c,R); if(!w) throw new Error('not waivable, pool='+pool.length+' tier='+c.tier+' need='+(R.quorum[c.tier]+1)); if(!acts(c,'p_elena').some(a=>a.id==='panel_waivequorum')) throw new Error('lead has no waive: '+names(c,'p_elena')); });
