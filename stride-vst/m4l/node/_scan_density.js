/** TEMP: report breakpoint density per .alc — max events in a single envelope. */
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');
function readXml(p){let x;const d=fs.readFileSync(p);try{x=zlib.gunzipSync(d).toString('utf-8');}catch(e){x=d.toString('utf-8');}return new DOMParser().parseFromString(x,'text/xml');}
function loopEnd(root){const L=root.getElementsByTagName('Loop');if(!L.length)return null;const k=L[0].childNodes;for(let i=0;i<k.length;i++)if(k[i].nodeType===1&&k[i].tagName==='LoopEnd')return parseFloat(k[i].getAttribute('Value'));return null;}
const dir = path.join(os.homedir(),'Desktop','Stride');
let files=[];const scan=d=>{if(!fs.existsSync(d))return;for(const f of fs.readdirSync(d))if(f.endsWith('.alc'))files.push(path.join(d,f));};
scan(dir);scan(path.join(dir,'template'));
const rows=[];
for(const f of files){
  let doc;try{doc=readXml(f);}catch(e){continue;}
  const root=doc.documentElement;const lEnd=loopEnd(root);
  let maxEv=0,totalEv=0,envCount=0;
  for(const tag of ['ClipEnvelope','AutomationEnvelope']){
    const envs=doc.getElementsByTagName(tag);
    for(let e=0;e<envs.length;e++){
      const events=envs[e].getElementsByTagName('Events');if(!events.length)continue;
      envCount++;let n=0;const kids=events[0].childNodes;
      for(let i=0;i<kids.length;i++)if(kids[i].nodeType===1)n++;
      maxEv=Math.max(maxEv,n);totalEv+=n;
    }
  }
  rows.push({f:path.basename(f),maxEv,totalEv,envCount,lEnd});
}
rows.sort((a,b)=>b.maxEv-a.maxEv);
console.log('maxEv  totalEv  envs  loopEnd  file');
for(const r of rows.slice(0,25)) console.log(String(r.maxEv).padStart(6),String(r.totalEv).padStart(8),String(r.envCount).padStart(5),String(r.lEnd).padStart(8),' ',r.f);
const distrib={'<=200':0,'201-1000':0,'1001-5000':0,'>5000':0};
for(const r of rows){const m=r.maxEv;if(m<=200)distrib['<=200']++;else if(m<=1000)distrib['201-1000']++;else if(m<=5000)distrib['1001-5000']++;else distrib['>5000']++;}
console.log('\nmax-events-per-envelope distribution across',rows.length,'files:');
for(const[k,v]of Object.entries(distrib))console.log(' ',k.padEnd(10),v);
