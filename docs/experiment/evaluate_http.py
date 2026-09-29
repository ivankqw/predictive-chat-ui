"""Evaluate a frozen synthetic set against the running decision service."""
import argparse, json, math, platform, statistics, time, urllib.request
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--cases',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--url',default='http://127.0.0.1:8014/api/decision')
args=parser.parse_args()
cases=json.loads(args.cases.read_text())
rows=[]
for case in cases:
    start=time.perf_counter()
    request=urllib.request.Request(args.url,data=json.dumps({'text':case['text'],'request_id':case['id']}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=180) as response:
        result=json.load(response)
    elapsed=(time.perf_counter()-start)*1000
    assert result['request_id']==case['id']
    scores=result['scores']
    assert set(scores)=={'calendar','checklist','compare','draft_message','none'}
    assert all(math.isfinite(v) and 0<=v<=1 for v in scores.values())
    raw=max(scores,key=scores.get)
    rows.append({**case,'response':result,'raw_choice':raw,'http_ms':round(elapsed,3)})
    print(case['id'],case['expected'],raw,result['intent'],round(elapsed,1),flush=True)
n=len(rows)
suggested=[r for r in rows if r['response']['intent']!='none']
positive=[r for r in rows if r['expected']!='none']
negative=[r for r in rows if r['expected']=='none']
latencies=sorted(r['http_ms'] for r in rows)
summary={'count':n,'raw_top1_correct':sum(r['raw_choice']==r['expected'] for r in rows),'gated_correct':sum(r['response']['intent']==r['expected'] for r in rows),'suggestions':len(suggested),'correct_suggestions':sum(r['response']['intent']==r['expected'] for r in suggested),'actionable_cases':len(positive),'correct_actionable_suggestions':sum(r['response']['intent']==r['expected'] for r in positive),'none_cases':len(negative),'unwanted_suggestions':sum(r['response']['intent']!='none' for r in negative),'http_p50_ms':statistics.median(latencies),'http_p95_ms':latencies[math.ceil(.95*n)-1],'model_p50_ms':statistics.median(r['response']['decision_ms'] for r in rows),'multiclass_brier_raw':sum(sum((s-float(label==r['expected']))**2 for label,s in r['response']['scores'].items()) for r in rows)/n}
args.output.write_text(json.dumps({'method':'Frozen synthetic authored cases, single pass, no prompt tuning on this set. Not representative of production users or Jev. Service warmed separately before evaluation. HTTP excludes frontend debounce/render.','platform':platform.platform(),'summary':summary,'rows':rows},indent=2)+'\n')
print(json.dumps(summary,indent=2))
