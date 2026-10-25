"""Build reviewable STEP 10 points from official files. See docs/traffic-facilities-step10.md.
Requires pyshp, pyproj, shapely. Input files stay outside git; no API keys are used.
"""
import argparse, collections, datetime, gzip, hashlib, io, json, math, pathlib, zipfile
import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import shape

parser = argparse.ArgumentParser()
parser.add_argument('input', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('data/facilities'))
parser.add_argument('--checked-at', type=datetime.date.fromisoformat, default=datetime.date.today())
args = parser.parse_args()
checked_at = args.checked_at.isoformat()
root = args.input
sources = {
 'seoul-crosswalks': {'name':'서울시 횡단보도 SHP', 'url':'https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do', 'fileVersion':'2021-08-09', 'region':'서울특별시', 'note':'2021년 공개 파일. 유효하지 않은 도형은 제외하며 현재 설치 현황 전수자료가 아닙니다.'},
 'seoul-humps': {'name':'서울시 험프 SHP', 'url':'https://data.seoul.go.kr/dataList/OA-15541/S/1/datasetView.do', 'fileVersion':'2025-04-17', 'region':'서울특별시', 'note':'공식 종류 001 요철 / 002 이미지. 유효하지 않은 도형은 제외하며 높이·고원식 여부는 추정하지 않습니다.'},
 'seoul-intersections': {'name':'서울시 교차로·교통신호제어기 SHP', 'url':'https://data.seoul.go.kr/dataList/OA-15534/S/1/datasetView.do', 'relatedUrl':'https://data.seoul.go.kr/dataList/OA-15538/S/1/datasetView.do', 'fileVersion':'교차로 2025-08-14 / 제어기 2021-08-09', 'region':'서울특별시', 'note':'시점이 다른 과거 제어기 연결은 신호교차로 후보입니다. 단일로 제외. 미연결을 비신호로 판단하지 않습니다.'},
 'national-crosswalks': {'name':'전국횡단보도표준데이터', 'url':'https://www.data.go.kr/data/15028201/standard.do', 'fileVersion':checked_at+' 다운로드', 'region':'경기도', 'note':'공식 다운로드 상한 50,000행 중 경기 자료. 일부 시군·기간만 포함하므로 전체 수록으로 간주하지 않습니다.'},
 'seoul-bridges': {'name':'서울시 육교정보', 'url':'https://data.seoul.go.kr/dataList/OA-22361/F/1/datasetView.do', 'fileVersion':'2022-12-31', 'region':'서울특별시', 'note':'대장의 주소를 카카오로 변환한 근사위치입니다. 실제 육교 중심·현재 존치 여부는 현장 확인이 필요합니다.'},
 'yangpyeong-round': {'name':'양평군 회전교차로 설치현황', 'url':'https://www.data.go.kr/data/15140141/fileData.do', 'fileVersion':'2025-12-09', 'region':'경기도', 'note':'양평군만 수록. 공식 주소의 카카오 변환 근사위치이며 실제 교차로 중심은 별도 확인이 필요합니다.'},
}
rows=[]; excluded=collections.Counter()
def add(id, kind, lat, lng, name, address, region, source, reference='', remark='', position='공식 도형 대표점'):
 if not all(math.isfinite(float(x)) for x in [lat,lng]) or not (36.8<=float(lat)<=38.4 and 126.2<=float(lng)<=128):
  excluded[source+':coordinate']+=1;return
 rows.append([str(id),kind,round(float(lat),7),round(float(lng),7),str(name or ''),str(address or ''),region,source,reference,remark,position])
def layers(data, prefix=''):
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  for n in z.namelist():
   if n.lower().endswith('.zip'):yield from layers(z.read(n),prefix+n+'/')
   if not n.lower().endswith('.shp'):continue
   base=n[:-4]; crs=CRS.from_wkt(z.read(base+'.prj').decode('utf8'))
   assert crs.to_epsg()==5186, 'Unexpected source CRS'
   enc=z.read(base+'.cpg').decode().strip() if base+'.cpg' in z.namelist() else 'cp949'
   # Some official files declare EUC-KR but contain CP949 extension characters.
   enc={'949':'cp949','65001':'utf8','EUC-KR':'cp949','euc-kr':'cp949'}.get(enc,enc)
   reader=shapefile.Reader(shp=io.BytesIO(z.read(n)),dbf=io.BytesIO(z.read(base+'.dbf')),encoding=enc)
   yield prefix+n,reader,Transformer.from_crs(crs,4326,always_xy=True)
def point(sr,tr):
 g=shape(sr.shape.__geo_interface__)
 if g.is_empty or not g.is_valid:raise ValueError('empty or invalid geometry')
 p=g.representative_point();lng,lat=tr.transform(p.x,p.y);return lat,lng
for name,reader,tr in layers((root/'humps.bin').read_bytes()):
 for sr in reader.iterShapeRecords():
  d=sr.record.as_dict();kind={'001':'speed_hump','002':'image_hump'}.get(d.get('A067_KND_C'))
  if not kind:excluded['hump:unknown_kind']+=1;continue
  try:lat,lng=point(sr,tr)
  except Exception:excluded['hump:geometry']+=1;continue
  add('seoul-hump:'+str(d['MGRNU']),kind,lat,lng,'','', '서울특별시','seoul-humps',remark='서울시 원본 종류 '+d['A067_KND_C'])
for name,reader,tr in layers((root/'crosswalks.bin').read_bytes()):
 if 'A004' not in name:continue
 for sr in reader.iterShapeRecords():
  d=sr.record.as_dict()
  try:lat,lng=point(sr,tr)
  except Exception:excluded['crosswalk:geometry']+=1;continue
  add('seoul-crosswalk:'+str(d['MGRNU']),'crosswalk',lat,lng,'','', '서울특별시','seoul-crosswalks',remark='서울시 원본 종류 '+str(d.get('A004_KND_C','')))
controllers=collections.defaultdict(list)
for _,reader,_ in layers((root/'controllers.bin').read_bytes()):
 for rec in reader.records():
  d=rec.as_dict();controllers[str(d.get('CSS_NUM'))].append(d)
intersection_numbers=collections.Counter()
for _,reader,_ in layers((root/'intersections.bin').read_bytes()):
 for rec in reader.records():intersection_numbers[str(rec.as_dict().get('CSS_NUM'))]+=1
for _,reader,tr in layers((root/'intersections.bin').read_bytes()):
 for sr in reader.iterShapeRecords():
  d=sr.record.as_dict()
  if d.get('A008_KND_C') not in ['002','003','004','005']:excluded['intersection:single_road']+=1;continue
  linked=controllers.get(str(d.get('CSS_NUM')),[])
  normal=[c for c in linked if c.get('CTR_FRM_CD') in ['001','002','003','004','005','006'] and c.get('CTR_SYS_CD') not in ['',None,'005','011']]
  # Conflicting, retired, pedestrian or flashing controllers prevent a signal candidate classification.
  candidate=bool(normal) and len(normal)==len(linked) and intersection_numbers[str(d.get('CSS_NUM'))]==1 and str(d.get('CSS_NUM')) not in ['', '0', 'None']
  kind='signal_intersection' if candidate else 'unknown_intersection'
  try:lat,lng=point(sr,tr)
  except Exception:excluded['intersection:geometry']+=1;continue
  remark='교차로번호 '+str(d.get('CSS_NUM'))+' / '+('과거 차량신호 제어기 연결: '+', '.join(str(c['MGRNU']) for c in normal) if candidate else '신호·비신호 미확인')
  add('seoul-intersection:'+str(d['MGRNU']),kind,lat,lng,d.get('CSS_NAM'),'','서울특별시','seoul-intersections',remark=remark,position='공식 교차로 점')
for d in json.load((root/'national-crosswalk-records.json').open()):
 if d.get('CTPRVN_NM')!='경기도':continue
 try:lat,lng=float(d['LATITUDE']),float(d['LONGITUDE'])
 except (ValueError,TypeError,KeyError):excluded['national-crosswalks:coordinate']+=1;continue
 id='gg-crosswalk:'+d['INSTT_CODE']+':'+d['CRSLK_MANAGE_NO']
 if not d['CRSLK_MANAGE_NO'].strip():excluded['national-crosswalks:missing_id']+=1;continue
 remark='보행자신호등 '+{'Y':'있음','N':'없음'}.get(d.get('TFCLGHT_YN'),'미확인')+' / 교차로 신호구분과 다름'
 add(id,'crosswalk',lat,lng,d.get('ROAD_NM'),d.get('RDNMADR') or d.get('LNMADR'),'경기도','national-crosswalks',d.get('REFERENCE_DATE',''),remark,'공식 위경도')
for d in json.load((root/'geocoded-addresses.json').open()):
 if 'lat' not in d:excluded[d['source']+':geocode']+=1;continue
 add(d['id'],d['kind'],d['lat'],d['lng'],d['name'],d['address'],d['region'],d['source'],d['date'],'원본 주소: '+d.get('rawAddress',d['address']),'주소 변환 근사위치')
# Duplicate IDs with conflicting location/attributes are removed, never arbitrarily chosen.
groups=collections.defaultdict(list)
for r in rows:groups[r[0]].append(r)
rows=[]
for id,rs in groups.items():
 if len(rs)>1:
  excluded['duplicate_id_rows']+=len(rs);continue
 rows.append(rs[0])
rows.sort(key=lambda r:r[0]);args.output.mkdir(parents=True,exist_ok=True)
encoded=json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode();compressed=gzip.compress(encoded,mtime=0)
(args.output/'facilities.json.gz').write_bytes(compressed)
for k,s in sources.items():
 s['count']=sum(r[7]==k for r in rows);s['checkedAt']=checked_at;s['referenceDate']= '2022-12-31' if k=='seoul-bridges' else ''
 s['license']='공공데이터 출처표시 / 원문 이용조건 참조'
manifest={'schema':1,'builtAt':checked_at,'sha256':hashlib.sha256(compressed).hexdigest(),'count':len(rows),'sources':sources,'excluded':dict(excluded),'counts':dict(collections.Counter(r[1] for r in rows)),'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.name in ['humps.bin','crosswalks.bin','controllers.bin','intersections.bin','bridges.bin','national-crosswalk-records.json','geocoded-addresses.json','yangpyeong-file.body']},'gyeonggiCrosswalkDistricts':sorted({d['SIGNGU_NM'] for d in json.load((root/'national-crosswalk-records.json').open()) if d.get('CTPRVN_NM')=='경기도'})}
(args.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'count':len(rows),'counts':manifest['counts'],'excluded':dict(excluded),'compressedBytes':len(compressed)},ensure_ascii=False))
