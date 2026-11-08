const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('eng.js','utf8').split('\n').filter(l=>!/^\s*export /.test(l)).join('\n');
const ctx={console,TextEncoder,Date,JSON,Math,Set,Map}; vm.createContext(ctx);
vm.runInContext(src+'\nthis.__x={defaultRules,consultNeeds,runScoring,buildSeed,actionsFor,perform,PEOPLE,byId,clone,newCase,assignAdviser,adviserForUnit,trainingBlocks,trainingState,matchCatalog,termHit,blankForm};',ctx);
const X=ctx.__x,R=X.defaultRules(),NOW=Date.now(),seed=X.buildSeed(NOW);
const person=id=>X.PEOPLE.find(p=>p.id===id);
const T=(n,f)=>{try{f();console.log('PASS',n)}catch(e){console.log('FAIL',n,'->',e.message.slice(0,260))}};
const cxT={rules:R,now:NOW,rv:1,training:seed.meta.training};
T('every unit has adviser',()=>{R.units.forEach(u=>{if(!X.byId(u.adviserId))throw new Error(u.id)})});
T('every person has a unit',()=>{X.PEOPLE.forEach(p=>{if(!R.units.some(u=>u.id===p.unit))throw new Error(p.id)})});
T('seed cases have advisers',()=>{seed.cases.forEach(c=>{if(!c.adviserId)throw new Error(c.id)})});
let nc=X.newCase('UC-9001','Test idea for pumps','Predict pump failures from vibration data.','p_priya',NOW,1);X.assignAdviser(nc,R);
T('new case adviser by unit',()=>{if(nc.adviserId!=='p_grant')throw new Error(nc.adviserId)});
T('suggestion: adviser can develop; other adviser cannot',()=>{const a=X.actionsFor(nc,person('p_grant'),cxT).map(x=>x.id),b=X.actionsFor(nc,person('p_jordan'),cxT).map(x=>x.id);if(!a.includes('develop'))throw new Error('adv: '+a);if(b.includes('develop'))throw new Error('other: '+b);const s=X.actionsFor(nc,person('p_priya'),cxT).map(x=>x.id);if(!s.includes('ask_adviser'))throw new Error('sub: '+s)});
T('ask adviser -> help_done',()=>{const c=X.perform(X.clone(nc),'ask_adviser',{message:'Where do I start?'},person('p_priya'),cxT);if(!c.outbox.some(m=>m.to.includes('p_grant')&&/Help requested/.test(m.subject)))throw new Error('no mail');const a=X.actionsFor(c,person('p_grant'),cxT).map(x=>x.id);if(!a.includes('help_done'))throw new Error(a);const d=X.perform(c,'help_done',{},person('p_grant'),cxT);if(X.actionsFor(d,person('p_grant'),cxT).some(x=>x.id==='help_done'))throw new Error('still offered')});
T('lead is adviser for legal unit',()=>{const c=X.newCase('UC-9002','x','y','p_claire',NOW,1);X.assignAdviser(c,R);if(c.adviserId!=='p_elena')throw new Error(c.adviserId)});
// training gate
let dev=X.perform(X.clone(nc),'develop',{},person('p_grant'),cxT);
T('untrained submitter blocked',()=>{const c=X.newCase('UC-9003','Idea','Idea text here','p_tomas',NOW,1);X.assignAdviser(c,R);const d=X.perform(c,'develop',{},person('p_tomas'),cxT);const sa=X.actionsFor(d,person('p_tomas'),cxT).find(a=>a.id==='submit');if(!sa||!sa.blockedMsg)throw new Error('no blockedMsg');let t=false;try{X.perform(d,'submit',{form:{}},person('p_tomas'),cxT)}catch(e){t=/Training is required/.test(e.message)&&/ai-training@example.com/.test(e.message)}if(!t)throw new Error('not blocked')});
T('trained submitter not blocked',()=>{const bl=X.trainingBlocks(seed.meta.training,person('p_priya'),R,NOW);if(bl.length)throw new Error('blocked')});
T('gate off when new training not required',()=>{const R2=X.clone(R);R2.trainings.forEach(t=>t.requiredToSubmit=false);if(X.trainingBlocks(seed.meta.training,person('p_tomas'),R2,NOW).length)throw new Error('blocked')});
// consult needs
const f=(o)=>Object.assign(X.blankForm('x','p_priya'),o);
T('data steward baseline recommended',()=>{const n=X.consultNeeds(f({ucType:'use',answers:{}}),R);if(!n.ca_data||n.ca_data.level!=='recommended')throw new Error(JSON.stringify(n.ca_data))});
T('data steward required on PII',()=>{const n=X.consultNeeds(f({ucType:'use',answers:{q_pii:true}}),R);if(n.ca_data.level!=='required')throw new Error(n.ca_data.level)});
T('AI safety not for decisions alone',()=>{const n=X.consultNeeds(f({ucType:'use',answers:{q_decide:true,q_hall:false},autonomy:'advice'}),R);if(n.ca_ai)throw new Error('suggested')});
T('AI safety for decisions + hall',()=>{const n=X.consultNeeds(f({ucType:'use',answers:{q_decide:true,q_hall:true}}),R);if(!n.ca_ai||n.ca_ai.level!=='recommended')throw new Error(JSON.stringify(n.ca_ai))});
T('AI safety required: outside content + tools',()=>{const n=X.consultNeeds(f({ucType:'build',answers:{q_model:true,q_outside:true,q_tools:true}}),R);if(!n.ca_ai||n.ca_ai.level!=='required')throw new Error(JSON.stringify(n.ca_ai))});
T('IT standards only with pending list',()=>{const a=X.consultNeeds(f({ucType:'vendor',answers:{q_listed:'listed'}}),R),b=X.consultNeeds(f({ucType:'vendor',answers:{q_listed:'pending'}}),R);if(a.ca_it||!b.ca_it||b.ca_it.level!=='recommended')throw new Error('wrong')});
T('cyber required when acts on IT',()=>{const n=X.consultNeeds(f({ucType:'build',autonomy:'automate',answers:{q_target:'it'}}),R);if(n.ca_cyber.level!=='required')throw new Error(n.ca_cyber.level)});
// consult dialog on fresh (non-legacy) case at panel
T('consult dialog suggests + forces required; recommended does not hold',()=>{let c=X.clone(seed.cases.find(x=>x.id==='UC-1012'));c.legacy=false;c.stage='panel';c.consults=[];c.panelNotes=[];c.form.answers=Object.assign({},c.form.answers,{q_pii:true});const lead=person('p_elena');const a=X.actionsFor(c,lead,cxT).find(x=>x.id==='consult');if(!a)throw new Error('no consult action');const sm=a.fields.find(x=>x.name==='smes');console.log('    pre-ticked',sm.value.join(','));if(!sm.value.includes('ca_data'))throw new Error('steward not suggested');
 const c2=X.perform(c,'consult',{smes:['p_jack'],reqSmes:[],question:'Q'},lead,cxT);console.log('    consults',c2.consults.map(k=>k.personId+':'+k.required).join(' '));if(!c2.consults.find(k=>k.personId==='p_omar'&&k.required))throw new Error('steward not forced');if(c2.consults.find(k=>k.personId==='p_jack').required)throw new Error('jack should be recommended')});
T('matcher ranks and skips stop words',()=>{const m=X.matchCatalog('that with Predict pump failures from vibration sensors',[{id:'t1',name:'Vibration monitor',purpose:'Pump vibration sensors',status:'approved'},{id:'t2',name:'Other',purpose:'with that',status:'approved'}],[],10);console.log('    ',m.map(x=>x.ref.id+':'+x.words.join('/')).join(' '));if(m.length!==1||m[0].ref.id!=='t1')throw new Error('bad')});
