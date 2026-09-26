"""PID-02 water-column annotation tool for pre-registration PID02-WCREF-v1: a human-only local interface.

One image at a time from the frozen sample, under its opaque id; zoom and pan; the two frozen views (NATIVE, the
stored 8-bit values; CONTRAST_HISTEQ, global histogram equalization); per side (IMAGE_LEFT, IMAGE_RIGHT) row segments
with a state and, where the protocol allows, an inclusive native-column interval. No assistance of any kind: no
overlays but the annotator's own marks, no snapping, no suggestions, and no model, label or estimator code.

Each role writes only ``<annotations-root>/<ROLE>/annotations.jsonl``, append-only; a correction is a new record that
supersedes the earlier one. The server binds to 127.0.0.1 and never opens another role's file.

Run: PYTHONPATH=packages:ml python -m round2.wc_annotate --role ANNOTATOR_A --corpus-root <frozen corpus>
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from round2.wc_prereg import ANNOTATIONS_ROOT, DEFAULT_OUT, PROTOCOL_VERSION, ROLES, SIDES, STATES, VIEWS

EXPERIENCE = ("NONE", "LIMITED", "EXPERIENCED")


class AnnotationError(ValueError):
    """A record, role or view outside the frozen protocol."""


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_annotation(payload: Mapping[str, Any], entry: Mapping[str, Any]) -> None:
    """Raise AnnotationError unless ``payload`` is a complete, schema-valid annotation of ``entry``."""
    if payload.get("opaque_id") != entry["opaque_id"]:
        raise AnnotationError("the annotation is not for this image")
    if payload.get("view") not in VIEWS:
        raise AnnotationError(f"view must be one of {VIEWS}")
    sides = payload.get("sides")
    if not isinstance(sides, dict) or sorted(sides) != sorted(SIDES):
        raise AnnotationError(f"sides must be exactly {SIDES}")
    width, height = entry["image_width"], entry["image_height"]
    for side in SIDES:
        segments = sides[side]
        if not isinstance(segments, list) or not segments:
            raise AnnotationError(f"{side}: at least one row segment is required")
        next_row = 0
        for segment in segments:
            start, end, state = segment.get("row_start"), segment.get("row_end"), segment.get("state")
            if not (_is_int(start) and _is_int(end)) or start != next_row or end < start or end > height - 1:
                raise AnnotationError(f"{side}: row segments must be contiguous and cover rows 0..{height - 1} once")
            next_row = end + 1
            if state not in STATES:
                raise AnnotationError(f"{side}: state must be one of {STATES}")
            x0, x1 = segment.get("x_start"), segment.get("x_end")
            located = x0 is not None or x1 is not None
            if located and not (_is_int(x0) and _is_int(x1) and 0 <= x0 <= x1 <= width - 1):
                raise AnnotationError(f"{side}: an interval needs integer columns 0 <= x_start <= x_end <= {width - 1}")
            if state == "AVAILABLE" and not located:
                raise AnnotationError(f"{side}: AVAILABLE needs an interval")
            if state == "NOT_VISIBLE" and located:
                raise AnnotationError(f"{side}: NOT_VISIBLE never carries a location")
            extra = set(segment) - {"row_start", "row_end", "state", "x_start", "x_end"}
            if extra:
                raise AnnotationError(f"{side}: unknown segment fields {sorted(extra)}")
        if next_row != height:
            raise AnnotationError(f"{side}: row segments must reach row {height - 1}")


def render(pixels: np.ndarray, view: str) -> np.ndarray:
    """The frozen display transforms of an 8-bit single-channel image."""
    if view not in VIEWS:
        raise AnnotationError(f"view must be one of {VIEWS}")
    if pixels.dtype != np.uint8 or pixels.ndim != 2:
        raise AnnotationError("only 8-bit single-channel images are eligible")
    if view == "NATIVE":
        return pixels.copy()
    counts = np.bincount(pixels.ravel(), minlength=256)
    cdf = np.cumsum(counts)
    cdf_min = cdf[counts.nonzero()[0][0]]
    total = pixels.size
    if total == cdf_min:
        return pixels.copy()
    lut = np.rint(255 * (cdf - cdf_min) / (total - cdf_min)).clip(0, 255).astype(np.uint8)
    return lut[pixels]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AnnotationStore:
    """One role's append-only record file."""

    def __init__(self, root: Path, role: str, *, protocol_version: str, protocol_sha256: str):
        if role not in ROLES:
            raise AnnotationError(f"role must be one of {ROLES}")
        self.role, self.protocol_version, self.protocol_sha256 = role, protocol_version, protocol_sha256
        self.path = Path(root) / role / "annotations.jsonl"

    def records(self) -> list[dict[str, Any]]:
        if not self.path.is_file():
            return []
        records = [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()]
        for record in records:
            if record.get("annotator") != self.role or record.get("protocol_version") != self.protocol_version \
                    or record.get("protocol_sha256") != self.protocol_sha256:
                raise AnnotationError(f"{self.path} holds a record of another role or protocol")
        return records

    def _append(self, record: dict[str, Any], key: str) -> dict[str, Any]:
        records = self.records()
        previous = [r for r in records if r["record_type"] == record["record_type"] and r.get(key) == record.get(key)]
        record = {**record, "record_id": f"{self.role}:{len(records) + 1:06d}",
                  "supersedes": previous[-1]["record_id"] if previous else None,
                  "annotator": self.role, "protocol_version": self.protocol_version, "protocol_sha256": self.protocol_sha256}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
        return record

    def declare(self, *, prior_sonar_experience: str, participated_in_estimator_development: bool) -> dict[str, Any]:
        if prior_sonar_experience not in EXPERIENCE:
            raise AnnotationError(f"prior_sonar_experience must be one of {EXPERIENCE}")
        if not isinstance(participated_in_estimator_development, bool):
            raise AnnotationError("participated_in_estimator_development must be true or false")
        return self._append({"record_type": "annotator_declaration", "role": "independent annotator",
                             "prior_sonar_experience": prior_sonar_experience,
                             "participated_in_estimator_development": participated_in_estimator_development,
                             "declared_at": _now()}, "record_type")

    def declaration(self) -> dict[str, Any] | None:
        found = [r for r in self.records() if r["record_type"] == "annotator_declaration"]
        return found[-1] if found else None

    def append_annotation(self, payload: Mapping[str, Any], entry: Mapping[str, Any]) -> dict[str, Any]:
        validate_annotation(payload, entry)
        return self._append({"record_type": "annotation", "opaque_id": entry["opaque_id"],
                             "source_sha256": entry["source_sha256"], "image_width": entry["image_width"],
                             "image_height": entry["image_height"], "sides": payload["sides"], "view": payload["view"],
                             "submitted_at": _now()}, "opaque_id")

    def latest(self) -> dict[str, dict[str, Any]]:
        return {r["opaque_id"]: r for r in self.records() if r["record_type"] == "annotation"}


def load_prereg(prereg_dir: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]], str]:
    """(protocol, protocol SHA-256, sample, instructions), refused unless the file hashes match the protocol."""
    prereg_dir = Path(prereg_dir)
    protocol_bytes = (prereg_dir / "protocol.json").read_bytes()
    protocol = json.loads(protocol_bytes)
    sample_bytes, instructions = (prereg_dir / "sample.jsonl").read_bytes(), (prereg_dir / "instructions.md").read_text()
    if hashlib.sha256(sample_bytes).hexdigest() != protocol["files"]["sample.jsonl"] or \
            hashlib.sha256(instructions.encode()).hexdigest() != protocol["files"]["instructions.md"]:
        raise AnnotationError("the pre-registration files do not match their frozen hashes")
    if protocol["protocol_version"] != PROTOCOL_VERSION:
        raise AnnotationError("this tool serves protocol " + PROTOCOL_VERSION)
    sample = [json.loads(line) for line in sample_bytes.decode().splitlines() if line.strip()]
    return protocol, hashlib.sha256(protocol_bytes).hexdigest(), sample, instructions


def _png(pixels: np.ndarray) -> bytes:
    from PIL import Image
    buffer = io.BytesIO()
    Image.fromarray(pixels, mode="L").save(buffer, format="PNG")
    return buffer.getvalue()


def make_server(store: AnnotationStore, sample: list[dict[str, Any]], instructions: str, corpus_root: Path,
                port: int) -> ThreadingHTTPServer:
    from PIL import Image
    entries = {entry["opaque_id"]: entry for entry in sample}
    items = [{"opaque_id": e["opaque_id"], "width": e["image_width"], "height": e["image_height"]}
             for e in sorted(sample, key=lambda e: e["presentation_rank"])]

    def pixels_of(entry: Mapping[str, Any]) -> np.ndarray:
        data = (Path(corpus_root) / entry["source_path"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["source_sha256"]:
            raise AnnotationError("image bytes do not match the frozen SHA-256")
        with Image.open(io.BytesIO(data)) as image:
            return np.asarray(image)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:
            return

        def _send(self, status: int, body: bytes, kind: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, value: Any) -> None:
            self._send(status, json.dumps(value).encode(), "application/json")

        def do_GET(self) -> None:
            if self.path == "/":
                return self._send(200, PAGE.encode(), "text/html; charset=utf-8")
            if self.path == "/api/session":
                return self._json(200, {"role": store.role, "protocol_version": store.protocol_version,
                                        "declared": store.declaration() is not None, "items": items,
                                        "latest": {k: {"sides": v["sides"], "view": v["view"]} for k, v in store.latest().items()},
                                        "instructions": instructions, "states": list(STATES), "views": list(VIEWS)})
            parts = self.path.strip("/").split("/")
            if len(parts) == 3 and parts[0] == "image" and parts[1] in entries and parts[2] in VIEWS:
                try:
                    return self._send(200, _png(render(pixels_of(entries[parts[1]]), parts[2])), "image/png")
                except AnnotationError as error:
                    return self._json(409, {"error": str(error)})
            self._json(404, {"error": "not found"})

        def do_POST(self) -> None:
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                if self.path == "/api/declare":
                    record = store.declare(prior_sonar_experience=body.get("prior_sonar_experience"),
                                           participated_in_estimator_development=body.get("participated_in_estimator_development"))
                elif self.path == "/api/annotate":
                    if store.declaration() is None:
                        raise AnnotationError("declare prior experience and estimator participation first")
                    entry = entries.get(body.get("opaque_id"))
                    if entry is None:
                        raise AnnotationError("unknown image")
                    record = store.append_annotation(body, entry)
                else:
                    return self._json(404, {"error": "not found"})
                return self._json(200, {"record_id": record["record_id"], "supersedes": record["supersedes"]})
            except (AnnotationError, json.JSONDecodeError) as error:
                return self._json(400, {"error": str(error)})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PID-02 annotation</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font:14px system-ui,sans-serif;background:#1b1d21;color:#e8e8e8;display:flex;flex-direction:column;height:100vh}
header{display:flex;gap:10px;align-items:center;padding:6px 10px;background:#25282e;flex-wrap:wrap}
main{flex:1;display:flex;min-height:0}#wrap{flex:1;position:relative;background:#000;min-width:0}
canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
aside{width:340px;overflow:auto;padding:10px;background:#22252a;border-left:1px solid #333}
button,select,input{font:inherit;background:#33373e;color:#eee;border:1px solid #555;border-radius:4px;padding:3px 7px}
button.on{background:#4a6fa5}.seg{border:1px solid #444;border-radius:5px;padding:6px;margin:6px 0}.seg.sel{border-color:#8ab4f8}
input[type=number]{width:80px}#msg{min-height:1.2em;color:#f6c177}#pos{margin-left:auto;font-variant-numeric:tabular-nums}
pre{white-space:pre-wrap;font-size:12px;color:#bbb}dialog{background:#25282e;color:#eee;border:1px solid #555}
</style></head><body>
<header><b id="who"></b><span id="prog"></span><button id="prev">&larr; Prev</button><button id="next">Next &rarr;</button>
<button id="vNATIVE">NATIVE</button><button id="vCONTRAST_HISTEQ">CONTRAST_HISTEQ</button><button id="fit">Fit width</button>
<button id="submit"><b>Submit</b></button><span id="pos"></span></header>
<main><div id="wrap"><canvas id="cv"></canvas></div><aside>
<div><button id="sIMAGE_LEFT">IMAGE_LEFT</button> <button id="sIMAGE_RIGHT">IMAGE_RIGHT</button></div>
<div id="segs"></div><div id="msg"></div>
<details><summary>Instructions</summary><pre id="instr"></pre></details></aside></main>
<dialog id="decl"><form method="dialog"><p>Before annotating, declare:</p>
<p>Prior sonar experience <select id="exp"><option>NONE</option><option>LIMITED</option><option>EXPERIENCED</option></select></p>
<p>Did you take part in developing a water-column estimator? <select id="dev"><option value="false">No</option><option value="true">Yes</option></select></p>
<button id="declok">Declare</button></form></dialog>
<script>
const $=id=>document.getElementById(id);let S,idx=0,view="NATIVE",side="IMAGE_LEFT",sel=0,pick=null,marks={},img=new Image(),sc=1,ox=0,oy=0;
const cv=$("cv"),cx=cv.getContext("2d");
function item(){return S.items[idx]}
function blank(h){return {IMAGE_LEFT:[{row_start:0,row_end:h-1,state:null,x_start:null,x_end:null}],IMAGE_RIGHT:[{row_start:0,row_end:h-1,state:null,x_start:null,x_end:null}]}}
async function boot(){S=await (await fetch("/api/session")).json();$("who").textContent=S.role+" · "+S.protocol_version;$("instr").textContent=S.instructions;
 const done=S.items.findIndex(i=>!S.latest[i.opaque_id]);idx=done<0?0:done;if(!S.declared)$("decl").showModal();load()}
$("declok").onclick=async e=>{e.preventDefault();const r=await fetch("/api/declare",{method:"POST",body:JSON.stringify({prior_sonar_experience:$("exp").value,participated_in_estimator_development:$("dev").value==="true"})});
 if(r.ok){S.declared=true;$("decl").close()}else{alert((await r.json()).error)}};
function load(){const it=item(),l=S.latest[it.opaque_id];marks=l?JSON.parse(JSON.stringify(l.sides)):blank(it.height);if(l)view=l.view;sel=0;pick=null;
 $("prog").textContent=`Image ${idx+1}/${S.items.length} · ${it.opaque_id} · ${it.width}×${it.height}`+(l?" · annotated":"");setImg();panel()}
function setImg(){img=new Image();img.onload=()=>{fit();draw()};img.src=`/image/${item().opaque_id}/${view}`;for(const v of S.views)$("v"+v).classList.toggle("on",v===view)}
function fit(){const r=cv.getBoundingClientRect();cv.width=r.width;cv.height=r.height;sc=r.width/item().width;ox=0;oy=0}
function draw(){const r=cv.getBoundingClientRect();if(cv.width!==r.width||cv.height!==r.height){cv.width=r.width;cv.height=r.height}
 cx.setTransform(1,0,0,1,0,0);cx.fillStyle="#000";cx.fillRect(0,0,cv.width,cv.height);cx.imageSmoothingEnabled=false;cx.setTransform(sc,0,0,sc,ox,oy);
 if(img.complete)cx.drawImage(img,0,0);
 for(const s of ["IMAGE_LEFT","IMAGE_RIGHT"])marks[s].forEach((g,i)=>{const act=s===side&&i===sel;
  if(g.x_start!==null&&g.x_end!==null){cx.fillStyle=g.state==="AVAILABLE"?(s==="IMAGE_LEFT"?"rgba(80,160,255,.35)":"rgba(255,140,60,.35)"):"rgba(200,200,200,.2)";
   cx.fillRect(g.x_start,g.row_start,g.x_end-g.x_start+1,g.row_end-g.row_start+1)}
  cx.strokeStyle=act?"#fff":"#888";cx.lineWidth=1/sc;cx.beginPath();cx.moveTo(0,g.row_start);cx.lineTo(item().width,g.row_start);cx.stroke()})}
function px(e){const r=cv.getBoundingClientRect();return [Math.floor((e.clientX-r.left-ox)/sc),Math.floor((e.clientY-r.top-oy)/sc)]}
let drag=null;cv.onmousedown=e=>{drag={x:e.clientX,y:e.clientY,ox,oy,moved:false}};
window.onmouseup=e=>{if(drag&&!drag.moved&&pick&&e.target===cv)apply(px(e));drag=null};
cv.onmousemove=e=>{const [x,y]=px(e);$("pos").textContent=`col ${x} · row ${y}`;if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;if(drag.moved){ox=drag.ox+dx;oy=drag.oy+dy;draw()}}};
cv.onwheel=e=>{e.preventDefault();const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,f=e.deltaY<0?1.25:0.8;ox=mx-(mx-ox)*f;oy=my-(my-oy)*f;sc*=f;draw()};
function clampc(v,hi){return Math.max(0,Math.min(hi,v))}
function apply([x,y]){const it=item(),segs=marks[side],g=segs[sel];
 if(pick==="x_start"||pick==="x_end"){g[pick]=clampc(x,it.width-1)}
 else if(pick==="split"){const row=clampc(y,it.height-1);const k=segs.findIndex(s=>s.row_start<row&&row<=s.row_end);
  if(k>=0){const s=segs[k];segs.splice(k+1,0,{row_start:row,row_end:s.row_end,state:null,x_start:null,x_end:null});s.row_end=row-1;sel=k+1}}
 pick=null;panel();draw()}
function panel(){for(const s of ["IMAGE_LEFT","IMAGE_RIGHT"])$("s"+s).classList.toggle("on",s===side);const box=$("segs");box.innerHTML="";
 marks[side].forEach((g,i)=>{const d=document.createElement("div");d.className="seg"+(i===sel?" sel":"");
  d.innerHTML=`<div>${side} · rows ${g.row_start}–${g.row_end}</div>`+S.states.map(st=>`<label><input type=radio name=st${i} value=${st} ${g.state===st?"checked":""}> ${st}</label>`).join(" ")+
  `<div>x_start <input type=number data-k=x_start value=${g.x_start??""}> x_end <input type=number data-k=x_end value=${g.x_end??""}></div>
   <div><button data-p=x_start>Click x_start</button> <button data-p=x_end>Click x_end</button> <button data-c=1>Clear interval</button></div>
   <div><button data-p=split>Split at clicked row</button> ${i<marks[side].length-1?"<button data-m=1>Merge with next</button>":""}</div>`;
  d.onclick=()=>{if(sel!==i){sel=i;panel();draw()}};
  d.querySelectorAll("input[type=radio]").forEach(r=>r.onchange=()=>{g.state=r.value;if(r.value==="NOT_VISIBLE"){g.x_start=null;g.x_end=null}panel();draw()});
  d.querySelectorAll("input[type=number]").forEach(n=>n.onchange=()=>{g[n.dataset.k]=n.value===""?null:parseInt(n.value,10);draw()});
  d.querySelectorAll("button[data-p]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();sel=i;pick=b.dataset.p;$("msg").textContent="Click on the image to set "+pick});
  d.querySelectorAll("button[data-c]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();g.x_start=null;g.x_end=null;panel();draw()});
  d.querySelectorAll("button[data-m]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();const n=marks[side][i+1];g.row_end=n.row_end;marks[side].splice(i+1,1);panel();draw()});
  box.appendChild(d)});$("msg").textContent=pick?"Click on the image to set "+pick:""}
for(const s of ["IMAGE_LEFT","IMAGE_RIGHT"])$("s"+s).onclick=()=>{side=s;sel=0;pick=null;panel();draw()};
for(const v of ["NATIVE","CONTRAST_HISTEQ"])$("v"+v).onclick=()=>{view=v;const o=[sc,ox,oy];img=new Image();img.onload=()=>{[sc,ox,oy]=o;draw()};img.src=`/image/${item().opaque_id}/${view}`;for(const w of S.views)$("v"+w).classList.toggle("on",w===view)};
$("fit").onclick=()=>{fit();draw()};$("prev").onclick=()=>{if(idx>0){idx--;load()}};$("next").onclick=()=>{if(idx<S.items.length-1){idx++;load()}};
$("submit").onclick=async()=>{const body={opaque_id:item().opaque_id,view,sides:marks};
 const r=await fetch("/api/annotate",{method:"POST",body:JSON.stringify(body)}),j=await r.json();
 if(!r.ok){$("msg").textContent="Not saved: "+j.error;return}S.latest[item().opaque_id]={sides:JSON.parse(JSON.stringify(marks)),view};
 $("msg").textContent="Saved "+j.record_id+(j.supersedes?" (supersedes "+j.supersedes+")":"");if(idx<S.items.length-1){idx++;load()}};
window.onresize=()=>draw();boot();
</script></body></html>"""


def main() -> int:
    parser = argparse.ArgumentParser(description="PID-02 water-column annotation tool (human only)")
    parser.add_argument("--role", required=True, choices=ROLES)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--prereg", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--annotations-root", type=Path, default=ANNOTATIONS_ROOT / "iter-1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    protocol, protocol_sha, sample, instructions = load_prereg(args.prereg)
    store = AnnotationStore(args.annotations_root, args.role, protocol_version=protocol["protocol_version"], protocol_sha256=protocol_sha)
    store.records()                                            # refuse a file of another role or protocol
    server = make_server(store, sample, instructions, args.corpus_root, args.port)
    print(f"{args.role}: http://127.0.0.1:{args.port}/  (writes {store.path})")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
