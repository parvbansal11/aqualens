"""Validation-only corruption harness; source imagery is read-only and outputs are separate."""
from __future__ import annotations
import argparse,csv,json,time
from pathlib import Path
from PIL import Image,ImageEnhance,ImageFilter
import numpy as np
def corrupt(a:np.ndarray, name:str)->np.ndarray:
 if name=="speckle": return np.clip(a*(1+np.random.default_rng(0).normal(0,.1,a.shape)),0,255).astype('uint8')
 if name=="dropout": a=a.copy();a[a.shape[0]//3:a.shape[0]//3+max(1,a.shape[0]//20)]=0;return a
 if name=="increasing_dropout":
  a=a.copy()
  for y in range(a.shape[0]//6,a.shape[0],max(1,a.shape[0]//20)): a[y:y+max(1,(y*a.shape[0])//(a.shape[0]*30))]=0
  return a
 if name=="black_region": a=a.copy();a[:a.shape[0]//5]=0;return a
 if name=="contrast_reduction": return np.asarray(ImageEnhance.Contrast(Image.fromarray(a)).enhance(.55))
 if name=="radiometric_shift": return np.clip(a.astype(np.int16)+30,0,255).astype('uint8')
 if name=="resolution_degradation": return np.asarray(Image.fromarray(a).resize((max(1,a.shape[1]//2),max(1,a.shape[0]//2))).resize((a.shape[1],a.shape[0])))
 if name=="blur": return np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(1.5)))
 if name=="target_clipping": a=a.copy();a[:, :max(1,a.shape[1]//10)]=0;return a
 if name=="nadir_width_perturbation": a=a.copy();w=max(1,a.shape[1]//12);c=a.shape[1]//2;a[:,c-w:c+w]=0;return a
 return a
def main():
 p=argparse.ArgumentParser();p.add_argument("validation_dir");p.add_argument("output_dir");a=p.parse_args(); out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True); rows=[]
 source=Path(a.validation_dir); candidates=[source] if source.is_file() else sorted(source.glob('*'))
 for path in candidates:
  if path.suffix.lower() not in {'.png','.jpg','.jpeg','.pbm'}:continue
  img=np.asarray(Image.open(path).convert('RGB'))
  for condition in ['speckle','contrast_reduction','radiometric_shift','dropout','increasing_dropout','resolution_degradation','blur','black_region','target_clipping','nadir_width_perturbation']:
   target=out/'corruptions'/condition/path.name;target.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(corrupt(img,condition)).save(target)
   rows.append({'source':str(path),'condition':condition,'detection_recall':None,'precision':None,'fp_count':None,'event_contact_recall':None,'evidence_score_drift':None,'latency_s':None,'failure_count':0,'metric_status':'UNAVAILABLE_UNTIL_FROZEN_DETECTOR_EXECUTED'})
 (out/'robustness_results.json').write_text(json.dumps(rows,indent=2));
 with (out/'robustness_results.csv').open('w',newline='') as f: w=csv.DictWriter(f,fieldnames=rows[0].keys() if rows else ['source']);w.writeheader();w.writerows(rows)
if __name__=='__main__':main()
