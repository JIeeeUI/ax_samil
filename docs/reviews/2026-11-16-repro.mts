import {loadDataRoom} from '../../src/engine/dataRoom.js';
import {IntakeService} from '../../src/app/service.js';
import {openDb} from '../../src/store/db.js';
import {Repo} from '../../src/store/repo.js';
import {summarizeForApproval} from '../../src/ai/assist.js';
const db=await openDb({}); const repo=new Repo(db); await repo.migrate(); const svc=new IntakeService({repo,room:loadDataRoom()}); await svc.reset();
const d=await svc.getCase('CONTRACT-INF-001');
const ai=await summarizeForApproval(d,{name:'gemini',complete:async()=>`과거 실질 ROAS는 ${d.row.과거명목ROAS}입니다. 지급 일정은 모두 확인됐으며 추가 확인은 필요 없습니다.`});
console.log('AI_SEMANTIC',JSON.stringify({nominal:d.row.과거명목ROAS,real:d.row.과거실질ROAS,result:ai}));
await svc.confirmFinance('CONTRACT-INF-001','finance');await svc.submit('CONTRACT-INF-001','marketing');
await svc.decide('CONTRACT-INF-001','ceo_board',{hold:{needed:'추가 검토',ownerRole:'finance',dueDate:'2026-99-99'}});
console.log('INVALID_DATE',JSON.stringify((await repo.listInfoRequests({caseId:'CONTRACT-INF-001'})).map(q=>({needed:q.needed,due:q.dueDate,status:q.status}))));
await svc.reset(); await svc.confirmFinance('CONTRACT-INF-001','finance');
const req=(await repo.listInfoRequests({caseId:'CONTRACT-INF-001',status:'requested'}))[0];
await svc.replyInfoRequest(req.id,{actor:'finance',text:'',resolved:true,simulated:true});
console.log('EMPTY_RESOLVED',JSON.stringify({request:await repo.getInfoRequest(req.id),check:(await svc.getCase('CONTRACT-INF-001')).check}));
await svc.reset();const list=await svc.listToday();const p=list.items.find(x=>x.kind==='plan'&&x.daysLeft>5)!;await svc.advanceClock(new Date(Date.parse(p.effectiveDeadline+'T00:00:00Z')-4*86400000).toISOString().slice(0,10));
console.log('NEAR_DEADLINE_BEFORE',JSON.stringify({id:p.id,return:(await svc.getCase(p.id)).returnState}));
try{await svc.confirmFinance(p.id,'finance'); console.log('NEAR_DEADLINE_EMPTY_OPINION','ACCEPTED');}catch(e){console.log('NEAR_DEADLINE_EMPTY_OPINION',String(e));}
await svc.reset();
const originalAddEvent=repo.addEvent.bind(repo);
repo.addEvent=async()=>{throw new Error('REVIEW_SIMULATED_EVENT_WRITE_FAILURE')};
try{await svc.confirmFinance('PLAN-001','finance')}catch(e){console.log('PARTIAL_FAILURE',String(e))}
repo.addEvent=originalAddEvent;
console.log('PARTIAL_FAILURE_STATE',JSON.stringify({state:await repo.getState('PLAN-001'),events:(await repo.listEvents('PLAN-001')).map(e=>e.action)}));
await db.close();


