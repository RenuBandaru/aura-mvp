const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('eng.js','utf8').split('\n').filter(l=>!/^\s*export /.test(l)).join('\n');
const ctx={console,TextEncoder,Date,JSON,Math,Set,Map}; vm.createContext(ctx);
vm.runInContext(src+'\nthis.__x={defaultRules,controlNeeds,runScoring,buildSeed,actionsFor,perform,PEOPLE,byId,clone,supportView,ctlApplies,looseThreads};',ctx);
const X=ctx.__x,R=X.defaultRules(),NOW=Date.now(),seed=X.buildSeed(NOW),cx={rules:R,now:NOW,rv:1};
const person=id=>X.PEOPLE.find(p=>p.id===id);
const T=(n,f)=>{try{f();console.log('PASS',n)}catch(e){console.log('FAIL',n,'->',e.message.slice(0,220))}};
// find a case with customer scope and escalation control claimed
let c=X.clone(seed.cases.find(x=>x.form&&x.form.scope==='customer'&&(x.form.controls||[]).includes('c_escalate')));
console.log('case',c&&c.id,c&&c.stage);
T('credit with applicable',()=>{const sc=X.runScoring(c.form,R,c.attestations);console.log('   credit',sc.controlCredit,'na',sc.inapplicable);if(sc.inapplicable.length)throw new Error('unexpected na')});
const before=X.runScoring(c.form,R,c.attestations).controlCredit;
c.form.scope='internal';
T('credit drops when it stops applying',()=>{const sc=X.runScoring(c.form,R,c.attestations);console.log('   credit',sc.controlCredit,'na',sc.inapplicable);if(!sc.inapplicable.includes('c_escalate'))throw new Error('not flagged');if(sc.controlCredit>=before)throw new Error('credit did not drop')});
T('supportView marks na',()=>{const sv=X.supportView(c,R);if(!sv.rows.find(r=>r.id==='c_escalate').na)throw new Error('na missing')});
T('not a loose thread',()=>{const lt=X.looseThreads(c,R);if(lt.some(t=>t.id==='ctl:c_escalate'))throw new Error('still a thread')});
T('remove_control action offered to submitter',()=>{const a=X.actionsFor(c,person(c.submitterId),cx).map(x=>x.id);console.log('   ',a.join(','));if(!a.includes('remove_control'))throw new Error('no action')});
// pending confirmer
c.attestations=(c.attestations||[]).filter(a=>a.controlId!=='c_escalate').concat([{controlId:'c_escalate',personId:'p_ravi',status:'pending',evidence:'',requestedAt:NOW,at:null,text:''}]);
c.form.attesters=Object.assign({},c.form.attesters,{c_escalate:'p_ravi'});
T('remove sends no-longer-needed mail',()=>{const n=c.outbox.length;const r=X.perform(c,'remove_control',{controlId:'c_escalate'},person(c.submitterId),cx);const m=r.outbox.slice(n);console.log('   ',m.map(x=>x.subject+' -> '+x.to).join(' | '));if(!m.some(x=>/No longer needed/.test(x.subject)&&x.to.includes('p_ravi')))throw new Error('no mail');if(r.form.controls.includes('c_escalate'))throw new Error('still claimed');if(!(r.removedControls||[]).length)throw new Error('not archived')});
T('remove refused while applicable',()=>{const c2=X.clone(seed.cases.find(x=>x.form&&(x.form.controls||[]).length));let t=false;try{X.perform(c2,'remove_control',{controlId:c2.form.controls[0]},person(c2.submitterId),cx)}catch(e){t=true}if(!t)throw new Error('allowed')});
