"""Download public files via their official links and the portal's documented download UI.
No bypass of login, CAPTCHA or access restrictions. Limited to the portal's 50,000-row export.
"""
import argparse, pathlib, json, urllib.request, urllib.parse, hashlib
parser=argparse.ArgumentParser();parser.add_argument('output',type=pathlib.Path);args=parser.parse_args()
out=args.output;out.mkdir(parents=True,exist_ok=True)
registry=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/facilities/source-files.json').read_text())
for name,m in registry.items():
 req=urllib.request.Request(m['url'],data=urllib.parse.urlencode(m.get('parameters',{})).encode() if m['method']=='POST' else None)
 with urllib.request.urlopen(req,timeout=60) as res:b=res.read()
 if m.get('sha256') and hashlib.sha256(b).hexdigest()!=m['sha256']:raise RuntimeError(f'{name}: official file changed, review before updating snapshot')
 (out/name).write_bytes(b);print(name,len(b),flush=True)
with urllib.request.urlopen('https://www.data.go.kr/download/columList.json?pk=15028201&ext=JSON',timeout=30) as res:h=json.load(res)
(out/'crosswalk-header.json').write_text(json.dumps(h,ensure_ascii=False),encoding='utf-8')
params={'publicDataPk':'15028201','colNmList':h['tableVO']['colNmList'],'totalCount':h['totalCount'],'svcTableNm':h['tableVO']['svcTableNm'],'perPage':10000}
rows=[];seen=set()
for page in range(1,(min(int(h['totalCount']),50000)+9999)//10000+1):
 params['page']=page
 with urllib.request.urlopen('https://www.data.go.kr/download/standard.json?'+urllib.parse.urlencode(params,doseq=True),timeout=60) as res:b=res.read()
 data=json.loads(b);digest=hashlib.sha256(b).hexdigest()
 if not isinstance(data,list) or digest in seen:raise RuntimeError('Unexpected/repeated official export page')
 seen.add(digest);rows.extend(data);print('crosswalk page',page,len(data),flush=True)
if len(rows)!=min(int(h['totalCount']),50000):raise RuntimeError('Incomplete official export')
(out/'national-crosswalk-records.json').write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
