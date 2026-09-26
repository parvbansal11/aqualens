"""PID-02 water-column reference pre-registration (spec Amendment E-2): the frozen protocol and its train-only sample.

Selection (no pixels, no ground truth, no detector output, no seed):
- SubPipe: per (channel, train Survey), frames sorted by (source timestamp, image_id); the first frame, then repeatedly
  the earliest frame at least FRAME_SECONDS after the last selected one. FRAME_SECONDS = 25 s is one frame's duration
  (500 rows at the B4 row shift of 20 rows per second between frames 1 s apart; audit F4, test_row_shift_verification),
  so selected frames share no pings. The build checks that pixel for pixel (QA only; it never changes the selection).
- AI4: census of every train image. PING: never eligible (range axis, orientation and crop undocumented).
- Presentation order and opaque ids: SHA-256(SALT | image_id), which uses immutable ids only.

The protocol content is deterministic: rebuilding from the same inputs gives byte-identical protocol.json,
sample.jsonl and instructions.md. Runtime facts (git state, times, command) go to artifact_manifest.json only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping

from round2.guards import FROZEN_MANIFEST_SHA256, GroundTruthFreeRow, LeakageError, load_frozen_manifest
from round2.manifest import REPO, TRACKED_METADATA, ManifestError, _subpipe_identity, load_corpus_rows

PROTOCOL_VERSION = "PID02-WCREF-v1"
SALT = PROTOCOL_VERSION
FRAME_SECONDS = Decimal(25)
ELIGIBLE_DATASETS = ("SUBPIPE", "AI4SHIPWRECKS")
ELIGIBLE_SPLIT = "train"                      # spec Amendment E-2: train only
ROLES = ("ANNOTATOR_A", "ANNOTATOR_B")
STATES = ("AVAILABLE", "AMBIGUOUS", "NOT_VISIBLE")
SIDES = ("IMAGE_LEFT", "IMAGE_RIGHT")
VIEWS = ("NATIVE", "CONTRAST_HISTEQ")
EVIDENCE_FLOOR = 30                           # spec §7.8
BOOTSTRAP_B = {"paired": 2000, "single": 1000}  # spec §7.3
DEFAULT_OUT = REPO / "artifacts/round2/PID02/wc_reference_protocol/iter-1"
ANNOTATIONS_ROOT = REPO / "artifacts/round2/PID02/wc_reference_annotations"
SPEC = REPO / "docs/ROUND2_HARDENING_SPEC.md"
TICKETS = REPO / "docs/ROUND2_TICKETS.md"


class PreregError(LeakageError):
    """The pre-registration cannot be built without crossing a frozen boundary; nothing is written."""


def _sha_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _sha_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def opaque_id(image_id: str) -> str:
    """The annotator-facing id: no dataset, split or image id is recoverable from it."""
    return _sha_text(f"{SALT}|{image_id}")[:16]


def bootstrap_seed() -> int:
    return int(_sha_text(SALT)[:8], 16)


def lattice(frames: Iterable[tuple[Decimal, str]]) -> list[str]:
    """Image ids of the Survey-anchored ping-disjoint lattice over (time, image_id) frames."""
    selected: list[str] = []
    last: Decimal | None = None
    for time, image_id in sorted(frames):
        if last is None or time - last >= FRAME_SECONDS:
            selected.append(image_id)
            last = time
    return selected


def select_sample(rows: list[Mapping[str, Any]], stamps: Mapping[str, tuple[str, Decimal]]) -> list[dict[str, Any]]:
    """The frozen sample, in presentation order. ``rows`` must be ground-truth-free views (guards.reference_view)."""
    if not all(isinstance(row, GroundTruthFreeRow) for row in rows):
        raise PreregError("selection accepts ground-truth-free rows only (guards.reference_view)")
    eligible = [row for row in rows if row["split"] == ELIGIBLE_SPLIT and row["dataset"] in ELIGIBLE_DATASETS]
    chosen: list[Mapping[str, Any]] = []
    surveys: dict[tuple[str, str], list[tuple[Decimal, str]]] = defaultdict(list)
    by_id = {row["image_id"]: row for row in eligible}
    for row in eligible:
        if row["dataset"] == "SUBPIPE":
            channel, time = stamps[row["image_id"]]
            if channel != row["channel"]:
                raise PreregError(f"{row['image_id']}: source channel {channel} differs from the manifest's {row['channel']}")
            surveys[(row["channel"], row["survey_id"])].append((time, row["image_id"]))
        else:
            chosen.append(row)
    for key in sorted(surveys):
        chosen.extend(by_id[image_id] for image_id in lattice(surveys[key]))
    if any(row["split"] != ELIGIBLE_SPLIT for row in chosen):
        raise PreregError("a non-train image reached the sample")
    entries = []
    for row in chosen:
        stamp = stamps.get(row["image_id"])
        entries.append({
            "opaque_id": opaque_id(row["image_id"]), "image_id": row["image_id"], "dataset": row["dataset"],
            "sensor": row["sensor"], "channel": row["channel"], "split": row["split"], "survey_id": row["survey_id"],
            "bootstrap_group": row["bootstrap_group"], "source_sha256": row["source_sha256"],
            "source_path": row["source_path"], "image_width": row["image_width"], "image_height": row["image_height"],
            "source_timestamp": str(stamp[1]) if row["dataset"] == "SUBPIPE" else None,
        })
    entries.sort(key=lambda entry: (_sha_text(f"{SALT}|{entry['image_id']}"), entry["image_id"]))
    for rank, entry in enumerate(entries):
        entry["presentation_rank"] = rank
    if len({entry["opaque_id"] for entry in entries}) != len(entries):
        raise PreregError("opaque id collision")
    return entries


def load_inputs() -> tuple[list[dict[str, Any]], dict[str, tuple[str, Decimal]]]:
    """The frozen H0-1 manifest (hash-checked) and SubPipe (channel, time) from the tracked corpus metadata.

    Only ``sample_id`` and ``original_filename`` are read from the metadata; its label fields are never touched.
    """
    manifest = load_frozen_manifest()
    subpipe = {row["image_id"] for row in manifest if row["dataset"] == "SUBPIPE"}
    stamps: dict[str, tuple[str, Decimal]] = {}
    for row in load_corpus_rows(TRACKED_METADATA):
        if row["sample_id"] in subpipe:
            channel, stamp = _subpipe_identity({"sample_id": row["sample_id"], "original_filename": row["original_filename"]})
            stamps[row["sample_id"]] = (channel, Decimal(stamp))
    if set(stamps) != subpipe:
        raise PreregError("SubPipe timestamps missing for some manifest rows")
    return manifest, stamps


def _counts(sample: list[dict[str, Any]]) -> dict[str, Any]:
    strata: dict[str, dict[str, Any]] = {}
    for key, members in (("SUBPIPE_HF", [e for e in sample if e["channel"] == "HF"]),
                         ("SUBPIPE_LF", [e for e in sample if e["channel"] == "LF"]),
                         ("AI4", [e for e in sample if e["dataset"] == "AI4SHIPWRECKS"])):
        strata[key] = {"images": len(members), "clusters": len({e["bootstrap_group"] for e in members}),
                       "surveys": len({e["survey_id"] for e in members})}
    return {"total_images": len(sample), "strata": strata,
            "splits": sorted({e["split"] for e in sample}), "datasets": sorted({e["dataset"] for e in sample})}


INSTRUCTIONS = """# PID-02 water-column annotation instructions (protocol PID02-WCREF-v1)

You are one of two independent annotators. Work alone. Do not look at, ask about or discuss the other annotator's
marks, any detector, estimator or anomaly output, any target labels or classes, or any D1 result. Annotate only in
the protocol's annotation tool.

## What you mark
Each image is a side-scan sonar waterfall: rows are pings, columns are slant range, and the vehicle track (nadir)
runs down the middle. Next to nadir on each side lies the water column (return from the water before the sound
reaches the seabed; it may be dark, noisy, uniform or completely blank). Further out, seabed backscatter begins.

For each side of the image separately (IMAGE_LEFT = columns left of the middle, IMAGE_RIGHT = columns right of it),
mark where the water column ends and the seabed return begins.

- AVAILABLE: you can see the transition. Mark the interval [x_start, x_end] of native pixel columns that contains
  it, with x_start <= x_end. Make the interval as narrow as you honestly can and as wide as you need: a sharp
  transition gets a narrow interval, a gradual one a wider interval. The interval must contain the whole
  transition for every row of the segment.
- AMBIGUOUS: a transition appears to be present but you cannot place it (for example, you cannot tell whether the
  seabed begins at the edge of a uniform or blank region or somewhere inside it). You may add a broad interval;
  it is recorded but never scored.
- NOT_VISIBLE: you cannot see a transition on that side in those rows (for example, it lies outside the image, the
  image has too few rows, or there is no water column). Do not guess a location.

Row segments: by default one segment covers all rows of a side. If the transition moves so much along the rows that
one interval would not contain it, split the side at a row and mark each segment separately. Segments cover every
row exactly once.

The two sides are independent: do not make them symmetric or equal in width unless that is what you see.
Ignore any objects, pipelines or wrecks; they are not part of this task.

## Display
You may zoom and pan, and switch between two views: NATIVE (the stored pixel values) and CONTRAST_HISTEQ (a fixed
global histogram equalization of the same image). No other adjustment exists. The view active when you submit is
recorded. Coordinates are always native image columns and rows.

## Records
Every submission is appended to your own file and never overwritten. To correct an image, submit it again: the new
record supersedes the old one, and both are kept. Before your first annotation, declare your prior sonar
experience (NONE, LIMITED or EXPERIENCED) and whether you took part in developing any water-column estimator.
"""


def build_protocol(sample: list[dict[str, Any]], hashes: Mapping[str, str], inputs: Mapping[str, Any],
                   qa: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The frozen protocol as data. Deterministic in its arguments."""
    unit = "row-side: one (image, side, row) triple"
    return {
        "protocol_id": "PID02-WCREF", "protocol_version": PROTOCOL_VERSION,
        "authority": {"spec": "ROUND2_HARDENING_SPEC.md Amendment E-2 (§7.1 exception; PID-02 availability; geometry record)",
                      "tickets": "ROUND2_TICKETS.md PID-02 (amended by E-2)"},
        "purpose": "A train-only blinded human pixel reference for validating a future water-column boundary procedure. "
                   "Validates geometry only: not detection, artificiality, anomalies, object depth or height, or bathymetry.",
        "pid02_status": "Water-column geometry is UNAVAILABLE for every dataset. No procedure is validated. This protocol "
                        "fixes only how a sensor-specific procedure may later be validated.",
        "inputs": dict(inputs), "files": dict(hashes),
        "eligible_population": {
            "split": ELIGIBLE_SPLIT, "datasets": list(ELIGIBLE_DATASETS),
            "SUBPIPE": "all train frames of the frozen H0-1 manifest, HF and LF as separate strata",
            "AI4SHIPWRECKS": "all train images of the frozen H0-1 manifest",
            "PING_GHOSTVISION": "not eligible"},
        "selection": {
            "subpipe_rule": "per (channel, train Survey): frames sorted by (source timestamp, image_id); select the first, "
                            "then repeatedly the earliest frame with t >= t_last + FRAME_SECONDS; every lattice frame is annotated",
            "frame_seconds": str(FRAME_SECONDS),
            "frame_seconds_derivation": "one frame = 500 rows; B4 row shift = 20 rows between frames 1 s apart (audit F4; "
                                        "k = 20 in test_row_shift_verification), so 25 s; frames >= 25 s apart share no pings",
            "subpipe_timestamp_source": "corpus metadata original_filename (SSS_<channel>_images/.../<timestamp>.pbm), "
                                        "read through manifest._subpipe_identity",
            "ai4_rule": "census: every train image; short or cropped images are not removed (states handle them)",
            "ping_rule": "none selected",
            "fields_read": ["image_id", "dataset", "sensor", "channel", "split", "survey_id", "bootstrap_group",
                            "source_sha256", "source_path", "image_width", "image_height", "original_filename (SubPipe time only)"],
            "never_used": ["pixels", "gt_* fields", "classes", "detector output", "anomaly output", "estimator output",
                           "DVL", "random seed"],
            "presentation_order": "ascending SHA-256(salt | image_id), identical for both annotators",
            "opaque_id": "first 16 hex digits of SHA-256(salt | image_id)", "salt": SALT},
        "counts": _counts(sample),
        "annotation_schema": {
            "sides": list(SIDES), "states": list(STATES),
            "segment": {"row_start": "int, inclusive", "row_end": "int, inclusive", "state": "one of states",
                        "x_start": "int or null", "x_end": "int or null"},
            "segment_rules": ["segments of a side are contiguous, non-overlapping and cover rows 0..H-1 exactly once",
                              "AVAILABLE: integers 0 <= x_start <= x_end <= W-1",
                              "AMBIGUOUS: both null, or integers as for AVAILABLE (recorded, never scored)",
                              "NOT_VISIBLE: both null"],
            "semantics": {
                "AVAILABLE": "a visible water-column-to-seabed transition; the interval contains it for every row of the segment",
                "AMBIGUOUS": "a transition appears present but cannot be placed (includes: onset may lie inside a uniform/blank region)",
                "NOT_VISIBLE": "no transition observable on that side in those rows; no location is recorded"},
            "transition": "moving outward from nadir along a row: the change from water column (including any uniform, "
                          "blank or zero-valued region) to seabed backscatter",
            "record_fields": ["record_type", "record_id", "supersedes", "annotator", "protocol_version", "protocol_sha256",
                              "opaque_id", "source_sha256", "image_width", "image_height", "sides", "view", "submitted_at"],
            "declaration_fields": ["record_type", "record_id", "supersedes", "annotator", "role", "prior_sonar_experience",
                                   "participated_in_estimator_development", "protocol_version", "protocol_sha256", "declared_at"]},
        "coordinate_convention": "native pixel grid, 0-indexed; x = column (slant range for SubPipe and AI4, spec KD-12), "
                                 "y = row (ping); intervals inclusive; sides named IMAGE_LEFT/IMAGE_RIGHT, never port/starboard; "
                                 "SubPipe row 0 is the newest ping (DERIVED_FROM_SOURCE, B4); display scaling never changes stored coordinates",
        "display": {
            "views": {"NATIVE": "the stored 8-bit single-channel values, unchanged (linear identity over the stored range 0-255)",
                      "CONTRAST_HISTEQ": "global histogram equalization of the whole image: v' = rint(255 (cdf(v) - cdf_min) / (N - cdf_min)), "
                                         "cdf over all N pixels, cdf_min = cdf of the lowest present value, rint = round half to even; "
                                         "a constant image is shown unchanged"},
            "default_view": "NATIVE", "controls": ["zoom", "pan", "switch between the two views"],
            "forbidden": ["any other intensity edit", "filters", "cropping", "resampling of the coordinate system", "overlays other than the annotator's own marks"],
            "view_recorded": "the view active at submission is stored in each record"},
        "blinding": {
            "hidden_from_annotators": ["image_id", "source path", "dataset/sensor/channel labels", "split", "Survey/site/block",
                                       "GT boxes and masks", "classes", "detector output", "H0-6 nadir", "estimator output",
                                       "anomaly and D1 results", "DVL", "the other annotator's marks"],
            "shown": ["the image pixels under an opaque id", "image width and height", "the annotator's own marks", "the instructions"],
            "limitation": "dataset and sensor identity cannot be hidden (distinct widths and appearance); strata are interleaved"},
        "annotators": {
            "roles": list(ROLES), "count": 2, "role": "independent annotator",
            "prior_sonar_experience_values": ["NONE", "LIMITED", "EXPERIENCED"],
            "declaration_required_before_first_annotation": True,
            "independence": ["each role writes only its own file; the tool never opens another role's file",
                             "no communication about marks until both reference files are frozen",
                             "participation in estimator development is declared and disclosed; it is not grounds to edit marks"],
            "expertise_claims": "none beyond the declared category"},
        "adjudication": {
            "required_by_primary_or_secondary_analysis": False,
            "rule": "disagreements are kept as reference uncertainty and enter the symmetric human benchmark; no routine adjudication",
            "if_ever_performed": "a separate record type by a third person who sees the image and both marks only (never estimator, "
                                 "detector, GT or anomaly output); it never overwrites or edits either original record; it cannot "
                                 "change any frozen formula; it requires a new protocol version"},
        "inter_rater": {
            "pass_threshold": None,
            "reported": ["h_human with cluster-bootstrap CI", "row-side interval overlap rate among rows both mark AVAILABLE",
                         "signed and absolute midpoint difference (native px) per stratum and side, Bland-Altman bias and limits",
                         "interval widths", "4x4 state confusion matrix and Cohen's kappa per stratum", "per-Survey/site breakdown"]},
        "human_benchmark": {
            "unit": unit, "human_point": "interval midpoint (x_start + x_end) / 2 of an AVAILABLE segment",
            "H(P->R)": "|{u in U(R): P AVAILABLE at u and point_P(u) in [x_start_R(u), x_end_R(u)]}| / |U(R)|, "
                       "U(R) = row-sides where R is AVAILABLE",
            "h_human": "(H(A->B) + H(B->A)) / 2, per stratum",
            "FA(P->R)": "|{u in V(R): P AVAILABLE at u}| / |V(R)|, V(R) = row-sides where R is NOT_VISIBLE",
            "FA_human": "(FA(A->B) + FA(B->A)) / 2, per stratum",
            "weighting": "every row-side counts once (ping weighting); image-averaged values are reported descriptively",
            "instantiation": "computed from the frozen annotation files by a script whose code is hash-recorded, written as a "
                             "hashed benchmark artifact of summaries only, before any estimator is evaluated; formulas never change after annotations are opened"},
        "estimator_acceptance": {
            "strata": ["SUBPIPE_HF", "SUBPIPE_LF", "AI4"], "pooling": "none",
            "estimator_output": "per image, side and row: AVAILABLE with an integer column, or UNAVAILABLE",
            "h_est": "(E(->A) + E(->B)) / 2, E(->X) = |{u in U(X): estimator AVAILABLE at u and column in X's interval}| / |U(X)|",
            "FA_est": "(FA(E->A) + FA(E->B)) / 2",
            "evidence_floor": f"stratum scorable iff, for each annotator X, >= {EVIDENCE_FLOOR} images contain an X-AVAILABLE row-side (spec §7.8); "
                              "otherwise INSUFFICIENT_REFERENCE",
            "fa_gating": f"FA gates only if, for each annotator X, >= {EVIDENCE_FLOOR} images contain an X-NOT_VISIBLE row-side; otherwise descriptive and disclosed",
            "pass": "scorable AND h_est >= h_human AND (FA not gating OR FA_est <= FA_human) AND zero catastrophic errors",
            "fail": "any other outcome; the stratum stays UNAVAILABLE",
            "threshold_source": "blinded human inter-annotator agreement under the identical scoring rule; no pixel tolerance, "
                                "minimum rate or margin is introduced",
            "reported_uncertainty": "paired cluster-bootstrap percentile 95 % CI of h_est - h_human (B = 2000); always reported",
            "order": ["reference frozen", "benchmark instantiated and frozen", "estimator developed and hash-frozen",
                      "one evaluation against the sealed reference"],
            "secondary_diagnostics": ["constant baseline (leave-one-cluster-out: per side, the median of both annotators' AVAILABLE "
                                      "midpoints over the other clusters of the stratum) scored like the estimator and disclosed",
                                      "signed bias by side", "abstention rate on AVAILABLE rows", "behaviour on AMBIGUOUS rows",
                                      "per-Survey/site/side breakdown", "image-averaged h_est", "DVL check on estimator widths"]},
        "availability_semantics": {
            "reference AVAILABLE": "scored for localization; estimator UNAVAILABLE there is a miss",
            "reference AMBIGUOUS": "excluded from localization and FA scoring; estimator behaviour reported",
            "reference NOT_VISIBLE": "scores false availability (estimator AVAILABLE there)",
            "humans": "the same rules apply to each annotator scored against the other"},
        "catastrophic_errors": {
            "rule": "any estimator AVAILABLE row-side with a column outside [0, W-1], a non-integer column, an IMAGE_LEFT column >= the "
                    "H0-6 nadir column, or an IMAGE_RIGHT column <= it",
            "consequence": "FAIL for that stratum (a structurally invalid output is not geometry); count reported"},
        "uncertainty": {"clusters": {"SUBPIPE": "H0-1 60-s block (spec §7.3)", "AI4": "wreck/terrain site (spec §7.3)"},
                        "bootstrap_B": dict(BOOTSTRAP_B), "interval": "percentile 95 %", "seed": bootstrap_seed(),
                        "note": "frames sharing a block are resampled together and never counted as independent blocks"},
        "dvl_secondary_check": {
            "role": "SECONDARY and descriptive; never gating; cannot rescue a stratum that fails the primary criterion",
            "scope": "SubPipe train reference frames in Surveys with DVL altitude",
            "width": "per annotator and frame: median over rows where both sides are AVAILABLE of (right midpoint - left midpoint), px",
            "altitude": "median of valid (!= -1) 'DVL Filtered' samples of the SubPipe Altitude.csv in the frame window",
            "alignment": "frame level only; three windows: [t - 25 s, t] (timestamp = newest ping, row 0), "
                         "[t - 12.5 s, t + 12.5 s], [t, t + 25 s] (timestamp = oldest ping)",
            "statistic": "Spearman rho within each (channel, Survey) with n reported (not computed for n < 3); per channel, the "
                         "Pearson correlation of within-Survey centred mid-ranks, cluster-bootstrap CI over blocks (B = 1000)",
            "expected_sign": "positive", "significance_threshold": None,
            "statement_rule": "a direction is stated only if the point estimates agree in sign under all three windows and both annotators",
            "cannot_show": ["pixel accuracy", "metric scale", "blanking versus seabed separation", "cross-Survey comparability"]},
        "confidence": {"numeric_confidence": "UNAVAILABLE",
                       "reason": "D invariant, C step 1 and F items 1-2 consume boundaries and availability only; availability states carry abstention"},
        "ai4": {"reference_status": "ANNOTATION_REFERENCED_NOT_PHYSICALLY_VALIDATED",
                "note": "no independent physical altitude evidence exists for AI4"},
        "ping": {"status": "UNAVAILABLE", "reason": "range axis, orientation, cropping and augmentation geometry undocumented"},
        "data_governance": {
            "reference_frame_access": "after freeze, selected images are viewed only for annotation and protocol QA until the human reference is frozen",
            "developer_access_to_selected_images_before_estimator_freeze": "NO; an annotator who also develops the estimator declares it, "
                                                                           "and the limitation is disclosed",
            "estimator_development_data": "non-selected train imagery only, and only after the human reference and benchmark are frozen",
            "estimator_development_never_uses": ["reference annotations", "val/test imagery for fitting", "target GT",
                                                 "detector outcomes", "anomaly outcomes"],
            "annotation_file_access": "annotation files are opened only by the annotation tool (own role) and the frozen benchmark "
                                      "and evaluation scripts; estimator development code never opens them",
            "spec_conflict": "none: spec §7.1 as amended by E-2 permits these train uses; H0-2 guards are unchanged"},
        "leakage_prohibitions": ["val or test images in the sample or in estimator fitting", "gt_* fields in selection or display",
                                 "detector, anomaly or D1 output anywhere in annotation or selection",
                                 "estimator output visible to annotators or adjudicators",
                                 "formulas or strata changed after annotations are opened",
                                 "thresholds chosen from estimator results"],
        "iteration_policy": "any change to this protocol is a new version and iteration; the estimator is evaluated once; a re-evaluation "
                            "after seeing results is a declared iteration (spec §7.2) and is disclosed as post hoc",
        "limitations": [
            "SubPipe non-selected train frames share pings with selected frames (the lattice spans every train ping), so developing "
            "on them exposes reference pixel content; the sealed quantity is the annotations",
            "the AI4 census leaves no non-selected AI4 train image; an AI4 procedure must be developed without AI4 imagery",
            "dataset/sensor identity is visible to annotators",
            "SubPipe covers one mission; AI4 has 13 train sites; intervals will be wide"],
        "open_criteria": [],
        "unresolved_not_blocking_annotation": ["AI4 estimator development data (see limitations)", "D1 treatment of PING"],
        "qa": dict(qa or {}),
    }


def _lattice_qa(sample: list[dict[str, Any]], corpus_root: Path) -> dict[str, Any]:
    """Pixel check that consecutive lattice frames share no identical row (QA only; never changes the selection)."""
    from sagar.vnext.surveys import load_native_pixels
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for entry in sample:
        if entry["dataset"] == "SUBPIPE":
            groups[(entry["channel"], entry["survey_id"])].append(entry)
    pairs, shared_max = 0, 0
    for key in sorted(groups):
        frames = sorted(groups[key], key=lambda e: (Decimal(e["source_timestamp"]), e["image_id"]))
        for first, second in zip(frames, frames[1:]):
            rows = [{hashlib.sha256(row.tobytes()).digest() for row in load_native_pixels(corpus_root / e["source_path"])}
                    for e in (first, second)]
            pairs += 1
            shared_max = max(shared_max, len(rows[0] & rows[1]))
    if shared_max:
        raise PreregError(f"lattice frames share {shared_max} identical rows; the 25-s derivation does not hold")
    return {"consecutive_lattice_pairs_checked": pairs, "max_identical_rows_shared": shared_max}


def write_prereg(out_dir: Path, corpus_root: Path, argv: list[str] | None = None) -> dict[str, Any]:
    out_dir, corpus_root = Path(out_dir), Path(corpus_root)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise PreregError(f"{out_dir} already holds a pre-registration; artifacts are immutable, use a new iteration")
    if ANNOTATIONS_ROOT.exists() and any(ANNOTATIONS_ROOT.rglob("*.jsonl")):
        raise PreregError("annotation records already exist; a pre-registration must precede annotation")
    started = datetime.now(timezone.utc).isoformat()
    corpus_metadata = corpus_root / "canonical/metadata.jsonl"
    if _sha_file(corpus_metadata) != _sha_file(TRACKED_METADATA):
        raise ManifestError("the corpus metadata differs from the repository's frozen copy")
    manifest, stamps = load_inputs()
    from round2.guards import reference_view
    sample = select_sample(reference_view(manifest), stamps)
    for entry in sample:
        if _sha_file(corpus_root / entry["source_path"]) != entry["source_sha256"]:
            raise PreregError(f"source SHA-256 mismatch for {entry['image_id']}")
    qa = {"source_sha256_verified": len(sample), **_lattice_qa(sample, corpus_root)}
    sample_text = "".join(json.dumps(entry, sort_keys=True) + "\n" for entry in sample)
    here = Path(__file__).parent
    inputs = {"frozen_manifest_sha256": FROZEN_MANIFEST_SHA256, "corpus_metadata_sha256": _sha_file(TRACKED_METADATA),
              "spec_sha256": _sha_file(SPEC), "tickets_sha256": _sha_file(TICKETS),
              "harness_source_sha256": {name: _sha_file(here / name) for name in ("wc_prereg.py", "wc_annotate.py", "guards.py", "manifest.py")}}
    hashes = {"sample.jsonl": _sha_text(sample_text), "instructions.md": _sha_text(INSTRUCTIONS)}
    protocol_text = json.dumps(build_protocol(sample, hashes, inputs, qa), indent=2, sort_keys=True) + "\n"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "sample.jsonl").write_text(sample_text)
    (out_dir / "instructions.md").write_text(INSTRUCTIONS)
    (out_dir / "protocol.json").write_text(protocol_text)
    git = lambda *args: subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()  # noqa: E731
    runtime = {"artifact": "PID-02 water-column reference pre-registration", "iteration": out_dir.name,
               "protocol_version": PROTOCOL_VERSION, "protocol_sha256": _sha_text(protocol_text),
               "scientific_files_sha256": {"protocol.json": _sha_text(protocol_text), **hashes},
               "git_sha": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
               "corpus_root": str(corpus_root), "annotations_present_at_freeze": False,
               "command": argv if argv is not None else sys.argv, "started_at": started,
               "finished_at": datetime.now(timezone.utc).isoformat(),
               "note": "runtime metadata only; not part of the scientific content"}
    (out_dir / "artifact_manifest.json").write_text(json.dumps(runtime, indent=2) + "\n")
    return runtime


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    print(json.dumps(write_prereg(args.out, args.corpus_root), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
