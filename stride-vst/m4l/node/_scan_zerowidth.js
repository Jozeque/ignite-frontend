/** TEMP: find the crash pattern — a curved FloatEvent whose segment to the
 *  NEXT event has ZERO time width (duplicate Time). Ableton renders a bezier
 *  over a 0-duration interval => divide-by-zero on play/draw. */
const fs=require('fs'),path=require('path'),os=require('os'),zlib=require('zlib');
const {DOMParser}=require('@xmldom/xmldom');
function readXml(p){let x;const d=fs.readFileSync(p);try{x=zlib.gunzipSync(d).toString('utf-8');}catch(e){x=d.toString('utf-8');}return new DOMParser().parseFromString(x,'text/xml');}
const dir=path.join(os.homedir(),'Desktop','Stride');
let files=[];const scan=d=>{if(!fs.existsSync(d))return;for(const f of fs.readdirSync(d))if(f.endsWith('.alc'))files.push(path.join(d,f));};
scan(dir);scan(path.join(dir,'template'));
let filesWithPattern=0, totalHits=0, examples=[];
for(const f of files){
  let doc;try{doc=readXml(f);}catch(e){continue;}
  let hits=0;
  for(const tag of ['ClipEnvelope','AutomationEnvelope']){
    const envs=doc.getElementsByTagName(tag);
    for(let e=0;e<envs.length;e++){
      const ev=envs[e].getElementsByTagName('Events');if(!ev.length)continue;
      const kids=[];const c=ev[0].childNodes;
      for(let i=0;i<c.length;i++)if(c[i].nodeType===1)kids.push(c[i]);
      for(let i=0;i<kids.length-1;i++){
        const t=parseFloat(kids[i].getAttribute('Time'));
        const tn=parseFloat(kids[i+1].getAttribute('Time'));
        const hasCurve=kids[i].hasAttribute('CurveControl1X');
        if(hasCurve && t===tn){
          hits++;totalHits++;
          if(examples.length<8)examples.push(`${path.basename(f)}  Time=${t} val=${kids[i].getAttribute('Value')} c1y=${kids[i].getAttribute('CurveControl1Y')}`);
        }
      }
    }
  }
  if(hits>0)filesWithPattern++;
}
console.log(`files with zero-width-curved-segment: ${filesWithPattern} / ${files.length}`);
console.log(`total occurrences: ${totalHits}`);
console.log('\nexamples:');for(const e of examples)console.log('  '+e);
