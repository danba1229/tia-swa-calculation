"""Build metadata only; never copy private source documents into Git."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument("research_root", type=Path)
args = parser.parse_args()
root = args.research_root
out = root / "outputs/chapter2-20261016"
read = lambda p: json.loads(p.read_text(encoding="utf-8-sig"))
research = read(out / "조사데이터.json")
delivery = read(out / "summary-work/chapter2_style_delivery_audit.json")
summaries = read(out / "summary-work/summary_output_manifest.json")
sources = read(out / "최신확정본_수집/collection_manifest.json")
scope_tree = ast.parse((root / "plan_scopes.py").read_text(encoding="utf-8-sig"))
scopes = next(ast.literal_eval(n.value) for n in scope_tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "SCOPES" for t in n.targets))
by_source = {Path(s["localPath"]).name: s for s in sources}
by_summary = {s["key"]: s for s in summaries}
by_research = {s["id"]: s for s in research["core"] + research["extra"]}
# Only documented geographic coverage is encoded. Unresolved metropolitan
# boundaries remain candidates, never invented municipal membership lists.
national = {"A01", "A03", "A05", "A07", "A09", "P02", "P05", "P13"}
province = {"A13": ["51", "42"], "A14": ["41"], "P14": ["41"], "P15": ["44"], "P16": ["48"], "P20": ["11"], "P31": ["11"], "P32": ["11"], "P34": ["11"]}
municipal = {"P21": ["4111"], "P22": ["41390"], "P23": ["41480"], "P24": ["41670"], "P29": ["51150", "42150"]}
periods = {"A01": [2022,2026], "A03": [2022,2026], "A05": [None,2030], "A07": [2021,2030], "A08": [2026,2030], "A09": [2026,2030], "A13": [2021,2040], "A14": [2026,2035], "P02": [2021,2040], "P03": [2021,2040], "P05": [2021,2030], "P11": [2021,2040], "P13": [2022,2026], "P14": [2021,2040], "P15": [2021,2040], "P16": [2021,2040], "P20": [None,2040], "P21": [2021,2040], "P22": [2021,2040], "P23": [2022,2040], "P24": [None,2035], "P29": [2016,2035], "P31": [2021,2030], "P32": [2026,2030], "P34": [2022,2026], "P46": [None,2030]}
exceptions = {
    "A14": ["참고", "승인본 대조 필요: 공개 보고서에 최종보고서/계획(안) 병기. 모란판교선 연장은 PDF 124쪽 3.94km, 163쪽 3.86km로 상이합니다."],
    "P02": ["대조 필요", "고시 근거와 별도로 수집 보고서 표지의 계획안 표기 및 최종본 동일성 확인이 필요합니다."],
    "P22": ["변경 추진 중", "기존 승인본을 표시합니다. 2026년 변경 추진 내용을 확정본으로 반영하지 않았습니다."],
    "P32": ["전문 미확보", "공식 요약자료만 확보했습니다. 전문 3권 미확보. 투자기간 2026~2030, 목표 2030, 장기 목표 2035를 구분합니다."],
}
plans = []
represented = set()
for f in delivery["files"]:
    key = f["key"]
    base = "A14" if key == "참고자료_A14" else key.split("_")[0]
    pid = "P46-urban" if key == "P46_서울_도시정비형" else "P46-residential" if key == "P46_서울_주거" else base
    represented.add(base)
    summary = by_summary[key]
    evidence = by_research[base]
    file = Path(f["output"])
    assert hashlib.sha256(file.read_bytes()).hexdigest() == f["sha256"], file
    scope = scopes[key]
    mapped_sources = [by_source[Path(p).name] for p in summary["sources"]]
    if base in national:
        coverage = {"kind": "national", "prefixes": []}
    elif base == "P03":
        coverage = {"kind": "metropolitan", "prefixes": ["11", "28", "41"]}
    elif base in municipal:
        coverage = {"kind": "municipal", "prefixes": municipal[base]}
    elif base in province:
        coverage = {"kind": "province", "prefixes": province[base]}
    else:
        coverage = {"kind": "unresolved", "prefixes": ["11"] if base == "P46" else []}
    status, note = exceptions.get(base, ["적용", "확인된 최신본 적용 / 후속 변경고시 미발견. 미발견은 변경이 없다는 확증이 아닙니다."])
    if base == "A14": status = "참고"
    if base == "P46": status, note = "구역 확인 필요", "서울 내 해당 용도·정비구역 여부를 별도로 확인해야 합니다."
    official = [{"url": s["sourcePage"], "kind": s["documentKind"], "sha256": s["sha256"], "fileName": s["fileName"]} for s in mapped_sources]
    plans.append({"planId": pid, "researchId": base, "versionId": f"{pid}-{f['sha256'][:12]}", "title": summary["title"], "period": periods[base], "periodText": scope[0], "scopeText": scope[1], "contentScope": scope[2], "pageEvidence": scope[3], "coverage": coverage, "status": status, "note": note, "approvalEvidence": evidence.get("latest", ""), "checkedAt": "2026-10-17", "modifiedAt": f["modifiedTime"], "sources": official, "summary": {"fileName": file.name, "sha256": f["sha256"], "bytes": f["bytes"], "driveId": f["driveId"]}})
for pid, evidence in by_research.items():
    if pid in represented: continue
    plans.append({"planId": pid, "researchId": pid, "versionId": f"{pid}-research-20261017", "title": evidence["name"], "period": [None,None], "periodText": evidence.get("latest", "확인 필요"), "scopeText": evidence.get("level", "확인 필요"), "contentScope": "", "pageEvidence": evidence.get("evidence", ""), "coverage": {"kind": "unresolved", "prefixes": []}, "status": "확인 필요", "note": evidence.get("note", "") + " / 자동 추천용 범위·버전 매핑 미검토", "approvalEvidence": evidence.get("applicationBasis", evidence.get("latest", "")), "checkedAt": evidence.get("checkedAt", "2026-10-16"), "modifiedAt": evidence.get("editedAt", "2026-10-17"), "sources": [{"url": u, "kind": "공식 근거·자료 페이지"} for u in evidence.get("source", []) if u.startswith("https://")], "summary": None})
destination = Path(__file__).resolve().parents[1] / "data/plans/registry.json"
official_hosts = {'state.gwd.go.kr', 'council.gangwon.kr', 'itskorea.kr', 'www.aurum.re.kr', 'www.codil.or.kr', 'www.krihs.re.kr', 'www.cheonancouncil.go.kr'}
for plan in plans:
    # Research notes also contain news articles. They must not appear as
    # official originals in this feature.
    plan['sources'] = [s for s in plan['sources'] if urlparse(s['url']).hostname.endswith('.go.kr') or urlparse(s['url']).hostname in official_hosts]
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps({"schemaVersion": 1, "registryVersion": "2026-10-17", "researchCount": 73, "summaryCount": 27, "plans": plans}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Metadata imported: {len(plans)} entries, {len(delivery['files'])} summaries. No documents copied.")
