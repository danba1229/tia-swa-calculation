"""Download public files via their official links and the portal's documented download UI.
No bypass of login, CAPTCHA or access restrictions.
"""
import argparse, pathlib, json, urllib.request, urllib.parse, hashlib
parser=argparse.ArgumentParser();parser.add_argument('output',type=pathlib.Path);args=parser.parse_args()
out=args.output;out.mkdir(parents=True,exist_ok=True)
registry=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/facilities/source-files.json').read_text(encoding='utf-8'))
for name,m in registry.items():
 req=urllib.request.Request(m['url'],data=urllib.parse.urlencode(m.get('parameters',{})).encode() if m['method']=='POST' else None)
 with urllib.request.urlopen(req,timeout=60) as res:b=res.read()
 if m.get('sha256') and hashlib.sha256(b).hexdigest()!=m['sha256']:raise RuntimeError(f'{name}: official file changed, review before updating snapshot')
 (out/name).write_bytes(b);print(name,len(b),flush=True)
# 경기 횡단보도는 Open API로 전체를 받는다: scripts/collect_gyeonggi_crosswalks.py
