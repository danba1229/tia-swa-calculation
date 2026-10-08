"""Build the reviewed Seoul sign snapshot. Requires pyshp and pyproj.
Usage: python scripts/build_seoul_sign_snapshot.py /path/to/research/evidence
Raw artifacts are verified against the recorded SHA-256 before processing.
"""
import sys, json, csv, io, gzip, hashlib, zipfile, math, collections
from pathlib import Path
import shapefile
from pyproj import Transformer, CRS
source=Path(sys.argv[1]);out=Path(__file__).resolve().parents[1]/'data/signs'
out.mkdir(parents=True,exist_ok=True)
def raw(name):
 b=(source/(name+'.body')).read_bytes();meta=json.loads((source/(name+'.json')).read_text())
 assert hashlib.sha256(b).hexdigest()==meta['sha256'], 'Source checksum mismatch'
 return b,meta
rows=[]; exclusions=collections.Counter()
b,sm=raw('seoul_verified_file_OA-15540');z=zipfile.ZipFile(io.BytesIO(b));base=next(n[:-4] for n in z.namelist() if n.endswith('.shp'))
assert CRS.from_wkt(z.read(base+'.prj').decode()).to_epsg()==5186
r=shapefile.Reader(shp=io.BytesIO(z.read(base+'.shp')),shx=io.BytesIO(z.read(base+'.shx')),dbf=io.BytesIO(z.read(base+'.dbf')),encoding='cp949')
counts=collections.Counter(str(v['MGRNU']).strip() for v in r.records());transform=Transformer.from_crs(5186,4326,always_xy=True)
for item in r.iterShapeRecords():
 d=item.record.as_dict();id=str(d['MGRNU']).strip()
 if not id or counts[id]!=1:exclusions['safety_duplicate_or_missing_id']+=1;continue
 if not item.shape.points:exclusions['safety_missing_geometry']+=1;continue
 x,y=item.shape.points[0]
 try:delta=math.hypot(x-float(d['XCE']),y-float(d['YCE']))
 except (ValueError,TypeError):delta=math.inf
 if not math.isfinite(delta) or delta>5:exclusions['safety_coordinate_conflict']+=1;continue
 lng,lat=transform.transform(x,y)
 if not (37.4<=lat<=37.72 and 126.75<=lng<=127.2):exclusions['safety_outside_review_envelope']+=1;continue
 # Source code is preserved, never decoded as speed limit or regulatory meaning.
 rows.append(['S:'+id,round(lat,7),round(lng,7),str(d.get('MRK_NUM') or ''),str(d.get('ESB_YMD') or ''),str(d.get('A064_KND_C') or '')])
b,rm=raw('seoul_sign_csv');text=b.decode('cp949')
roads=list(csv.DictReader(io.StringIO(text)));counts=collections.Counter(d['표지일련번호'].strip() for d in roads)
for d in roads:
 id=d['표지일련번호'].strip()
 if not id or counts[id]!=1:exclusions['road_duplicate_or_missing_id']+=1;continue
 try:lat,lng=float(d['위도']),float(d['경도'])
 except (ValueError,TypeError):exclusions['road_invalid_coordinate']+=1;continue
 if not (37.4<=lat<=37.72 and 126.75<=lng<=127.2):exclusions['road_outside_review_envelope']+=1;continue
 rows.append(['R:'+id,round(lat,7),round(lng,7),d['표지종별'],'',''])
rows.sort(key=lambda r:(r[1],r[2],r[0]))
content=json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()
compressed=gzip.compress(content,compresslevel=9,mtime=0);(out/'seoul-signs.json.gz').write_bytes(compressed)
meta={'version':'seoul-signs-20261008-v1','schema':['sourcePrefixedId','latitude','longitude','sourceIndexOrType','installedOn','specificationCode'], 'counts':dict(collections.Counter(r[0][0] for r in rows)), 'excluded':dict(exclusions),'sha256':hashlib.sha256(compressed).hexdigest(), 'reviewEnvelope':[126.75,37.4,127.2,37.72], 'sources':[
 {'key':'S','name':'서울시 안전표지 관련 정보','url':'https://data.seoul.go.kr/dataList/OA-15540/S/1/datasetView.do','file':'A064_P_안전표시_20260213.zip','fileVersion':'2026-02-13','facilityDate':None,'rawSha256':sm['sha256'],'rawCount':len(r),'license':'공공누리 1유형: 출처표시'},
 {'key':'R','name':'서울시 도로표지 설치정보','url':'https://data.seoul.go.kr/dataList/OA-15017/S/1/datasetView.do','file':'서울특별시 도로표지 설치현황(20250417).csv','fileVersion':'2025-04-17','facilityDate':None,'rawSha256':rm['sha256'],'rawCount':len(roads),'license':'공공누리 1유형: 출처표시'}],
 'notes':['서울시 공개 원본의 공간검색이며 최신 현장 시설 전체 목록이 아닙니다.','파일 버전과 시설 기준일은 다릅니다.','관리번호 중복, 좌표 불일치 5m 초과, 검토 영역 밖 자료는 제외했습니다. 검토 영역은 행정경계가 아닙니다.','표지인덱스·규격코드에서 실제 표지 내용을 추정하지 않습니다.']}
(out/'manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'counts':meta['counts'],'excluded':meta['excluded'],'compressedBytes':len(compressed)},ensure_ascii=False))
