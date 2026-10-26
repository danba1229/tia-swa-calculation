"""Collect every 경기도 row of 전국횡단보도표준데이터 through the data.go.kr Open API.
Needs DATA_GO_KR_CROSSWALK_KEY (approved usage key) in the environment; the key is never written out.
Fields are renamed to the bulk export's names (crslkManageNo -> CRSLK_MANAGE_NO) so the build reads one shape.
"""
import argparse, json, os, pathlib, re, time, urllib.parse, urllib.request
parser=argparse.ArgumentParser();parser.add_argument('output',type=pathlib.Path);args=parser.parse_args()
key=os.environ.get('DATA_GO_KR_CROSSWALK_KEY','').strip()
if not key:raise SystemExit('DATA_GO_KR_CROSSWALK_KEY is required')
enc=key if '%' in key else urllib.parse.quote(key,safe='')
API='https://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api'
PER=1000
def fetch(page):
 q=urllib.parse.urlencode({'pageNo':page,'numOfRows':PER,'type':'json','ctprvnNm':'경기도'})
 for attempt in range(4):
  try:
   with urllib.request.urlopen(f'{API}?serviceKey={enc}&{q}',timeout=90) as res:body=json.load(res)
   break
  except Exception:
   if attempt==3:raise
   time.sleep(3*(attempt+1))
 if body.get('response'):body=body['response']
 if body['header']['resultCode']!='00':raise RuntimeError('API error '+body['header']['resultCode'])
 items=body['body'].get('items') or []
 if isinstance(items,dict):items=items.get('item') or []
 return int(body['body']['totalCount']),items if isinstance(items,list) else [items]
snake=lambda k:re.sub(r'(?<!^)(?=[A-Z])','_',k).upper()
total,first=fetch(1);rows=list(first)
for page in range(2,(total+PER-1)//PER+1):
 rows.extend(fetch(page)[1]);print('page',page,len(rows),flush=True)
if len(rows)!=total:raise RuntimeError(f'Incomplete API pull: {len(rows)} of {total}')
rows=[{snake(k):('' if v is None else str(v)) for k,v in r.items()} for r in rows]
if any(r.get('CTPRVN_NM')!='경기도' for r in rows):raise RuntimeError('API returned rows outside 경기도')
args.output.mkdir(parents=True,exist_ok=True)
(args.output/'gyeonggi-crosswalk-api.json').write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
print('rows',len(rows),'reference dates',min(r['REFERENCE_DATE'] for r in rows),max(r['REFERENCE_DATE'] for r in rows))
