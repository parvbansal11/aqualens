"""Deterministic ablation report builder. Metrics unavailable in inputs remain null."""
from __future__ import annotations
import argparse,csv,json,time
from pathlib import Path
STACKS=["YOLO only","YOLO + physics verifier","YOLO + persistence","YOLO + physics + persistence","future YOLO + natural FP suppressor","future YOLO + RF-DETR","full available Aqualens stack"]
def main():
 p=argparse.ArgumentParser();p.add_argument("input_json");p.add_argument("output",default="ablation_results.json");a=p.parse_args(); start=time.perf_counter(); data=json.loads(Path(a.input_json).read_text())
 base={k:data.get(k) for k in ["precision","recall","false_positive_count","event_recall","review_burden_proxy"]}
 rows=[{"stack":x,**base,"latency_s":time.perf_counter()-start,"missing_metrics":[k for k,v in base.items() if v is None]} for x in STACKS]
 Path(a.output).write_text(json.dumps({"protocol":"validation-only","results":rows},indent=2));
if __name__=="__main__": main()
