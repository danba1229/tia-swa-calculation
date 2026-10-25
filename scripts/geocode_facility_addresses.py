"""Resolve official addresses to approximate points; never validates actual installation.
Run only against an authorized TIA deployment. No credentials are logged.
"""
import csv,io,pathlib,re,json,urllib.request,urllib.error,concurrent.futures,time
import argparse
parser=argparse.ArgumentParser();parser.add_argument('input',type=pathlib.Path);parser.add_argument('--geocode-base',required=True)
args=parser.parse_args();out=args.input;tasks=[]
for i,r in enumerate(csv.DictReader(io.StringIO((out/'bridges.bin').read_bytes().decode('cp949')))):
 a=r['소재지도로명주소'].strip(); district=re.search(r'([가-힣]+구)청',r['관리기관명'])
 if not district or any(v in a for v in ['~','∼','앞','일대']) or not re.search(r'\d',a):continue
 a=('서울 '+district[1]+' '+a) if not a.startswith('서울') else a
 tasks.append({'id':f'seoul-bridge:{i+1}','kind':'footbridge','name':r['육교명'],'address':a,'rawAddress':r['소재지도로명주소'],'date':r['데이터기준일자'],'region':'서울특별시','source':'seoul-bridges'})
for i,r in enumerate(csv.DictReader(io.StringIO((out/'yangpyeong-file.body').read_text(encoding='utf-8-sig')))):
 tasks.append({'id':f'yangpyeong-round:{i+1}','kind':'roundabout','name':r['교차로명'],'address':r['교차로위치지번주소'],'date':'','region':'경기도','source':'yangpyeong-round'})
cache={}
p=out/'geocoded-addresses.json'
if p.exists():cache={r['id']:r for r in json.load(p.open(encoding='utf-8'))}
def get(r):
 prior=cache.get(r['id'])
 if prior and 'lat' in prior and all(prior.get(k)==r.get(k) for k in ['address','rawAddress','date','name','source']):return prior
 try:
  req=urllib.request.Request(args.geocode_base.rstrip('/')+'/api/geocode',data=json.dumps({'address':r['address']}).encode(),headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=20) as res:j=json.load(res)
  if j.get('success') and j.get('code')=='PRECISE_ADDRESS':r.update(lat=j['latitude'],lng=j['longitude'],matchedAddress=j['matchedAddress'])
  else:r['error']='정밀 주소 일치 미확인'
 except Exception:r['error']='주소 조회 실패 또는 정밀 주소 미확인'
 return r
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 for r in ex.map(get,tasks):
  rows.append(r)
  if len(rows)%20==0:print('geocoded',len(rows),'/',len(tasks),flush=True)
p.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8');print('total',len(rows),'usable',sum('lat' in r for r in rows),flush=True)
