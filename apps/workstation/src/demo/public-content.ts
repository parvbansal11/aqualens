/**
 * Explanatory content for the public experience.
 *
 * Every string here is a description of how the system works. None of it is a
 * measurement, a score, or a result. See src/demo/README.md for the boundary
 * this file sits behind.
 */

export interface ChainStep {
  num: string;
  title: string;
  body: string;
  tag: string;
}

/** The narrative spine of the landing page: problem through to memory. */
export const CHAIN: ChainStep[] = [
  { num: "01", title: "The problem", body: "Kilometres of imagery per survey hour, and one interpreter's attention.", tag: "MOTIVATION" },
  { num: "02", title: "Survey", body: "A towed side-scan pass, ingested with its licence and checksum intact.", tag: "INGEST" },
  { num: "03", title: "Detect", body: "Known classes proposed by a closed-set detector, tile by tile.", tag: "PERCEIVE" },
  { num: "04", title: "Unknown anomaly", body: "An open-set head flags what the training set never contained. No class is forced.", tag: "OPEN-SET" },
  { num: "05", title: "Verify", body: "Shadow direction and persistence across overlapping windows test the candidate.", tag: "EVIDENCE" },
  { num: "06", title: "Locate", body: "Navigation turns a sonar frame position into a fix with stated uncertainty, or into a null.", tag: "GEO" },
  { num: "07", title: "Compare", body: "Against the prior pass, and only inside the new coverage polygon.", tag: "CHANGE" },
  { num: "08", title: "Prioritise", body: "A transparent weighted score orders the recovery list, with every weight visible.", tag: "MISSION" },
  { num: "09", title: "Expert review", body: "Confirm, reject, relabel, or mark uncertain. The operator holds the decision.", tag: "OPERATOR" },
  { num: "10", title: "Memory", body: "Every judgement appended, never overwritten, and available to the next comparison.", tag: "PERSIST" },
];

export interface Capability {
  title: string;
  body: string;
  mech: string;
}

export const CAPABILITIES: Capability[] = [
  {
    title: "Shadow aware reasoning",
    body: "In the sonar's own frame the acoustic shadow must fall on the far side of a target, at a length consistent with its height. Ordering, contrast and continuity are tested as evidence, so a bright return with no shadow behind it is treated as weaker rather than stronger.",
    mech: "evidence.shadow: ordering_ok, contrast_z, continuity",
  },
  {
    title: "Persistence across overlapping windows",
    body: "Tiling overlaps deliberately, so a real seabed object is seen several times at a stable position while speckle is not. Support is scored as a Wilson interval over observation opportunities, with positional scatter reported alongside it.",
    mech: "evidence.persistence: n_obs over n_opportunities, scatter_px",
  },
  {
    title: "Open-set unknown handling",
    body: "A candidate that resembles nothing in training is surfaced as an unknown anomaly candidate with an anomaly score and no class confidence at all. The contract forbids inventing a label to fill the field.",
    mech: "kind = UNKNOWN, class_confidence = null",
  },
  {
    title: "Memory and change detection on one substrate",
    body: "Operator reviews and prior survey history share a persistence layer, so a resurvey can be compared against human confirmed detections rather than raw model output. Absence outside the new coverage polygon is never reported as a removal.",
    mech: "status: NEW, UNCHANGED, REMOVED, NOT_SURVEYED",
  },
  {
    title: "Recovery priority scoring",
    body: "Contacts are ordered by a weighted sum of confidence, persistence, anomaly evidence, footprint, class weight and newness, with each weight, value and contribution shown, from a versioned config file. Decision support, stated as such.",
    mech: "priority_weights config, not a learned risk model",
  },
];

export interface ProblemCard {
  tag: string;
  title: string;
  body: string;
}

export const PROBLEMS: ProblemCard[] = [
  { tag: "VOLUME", title: "Hours of imagery, minutes of attention", body: "A single pass produces far more frames than can be read carefully. Triage happens implicitly, by fatigue, and leaves no record of what was skipped." },
  { tag: "AMBIGUITY", title: "The interesting object is the unfamiliar one", body: "Debris fields contain objects no training set anticipated. A classifier forced to choose among known classes will confidently mislabel exactly the contacts that matter most." },
  { tag: "GEOMETRY", title: "Sonar is not a photograph", body: "Intensity is acoustic return, position is slant range from nadir, and shadows carry height information. Treating a waterfall image as a picture discards the physics that makes verification possible." },
  { tag: "MEMORY", title: "Yesterday's judgement is not available today", body: "Resurveys get compared against raw model output because prior expert conclusions were never captured in a queryable form. The same contact is adjudicated again from scratch." },
];

export const NAIVE_APPROACH: string[] = [
  "Position in image x and y, so shadow direction is unrecoverable.",
  "Every region forced into a known class, with a confidence attached.",
  "A single look at a target, and no test of whether it persists.",
  "Missing metadata substituted with a default, silently.",
  "No record of the operator's conclusion once the session closes.",
];

export const OUR_APPROACH: string[] = [
  "Position as ping, range from nadir and side, so shadow geometry is testable.",
  "Unknowns kept unknown, with an anomaly score and no class confidence.",
  "Persistence scored across deliberately overlapping windows.",
  "A declared spatial reference level with a machine readable reason.",
  "Append-only review events, queryable by the next survey.",
];

export interface PipelineStage {
  id: string;
  num: number;
  title: string;
  body: string;
  receives: string;
  emits: string;
  refuses: string;
}

/** Stage ids match the backend pipeline stage names. */
export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "ingest", num: 1, title: "Ingest", body: "Source files are read with their licence and checksum recorded. A snapshot id fixes exactly which bytes a run saw.", receives: "raw survey files", emits: "snapshot_id, sha256, licence", refuses: "silent format coercion" },
  { id: "tile", num: 2, title: "Tile", body: "Frames are cut into overlapping windows along track. That overlap is what later makes persistence measurable rather than assumed.", receives: "frames", emits: "tiles with window overlap", refuses: "tiling across survey boundaries" },
  { id: "preprocess", num: 3, title: "Preprocess", body: "Nadir is located, port and starboard separated, speckle and dropout quantified. Every tile receives a spatial reference level computed from the metadata actually present.", receives: "tiles", emits: "L0 to L3 level and level_reason", refuses: "assuming a range scale" },
  { id: "perceive", num: 4, title: "Perceive", body: "A closed-set detector proposes known classes. An open-set head scores how unlike the training distribution a region is, producing unknown anomaly candidates with no class confidence at all.", receives: "preprocessed tiles", emits: "KNOWN and UNKNOWN candidates", refuses: "forcing an unknown into a class" },
  { id: "evidence", num: 5, title: "Evidence", body: "Three channels are computed in the sonar's own frame: acoustic shadow, persistence across overlapping windows, and range context. Each is applicable or not, with a reason.", receives: "candidates", emits: "channel scores, or null with a reason", refuses: "scoring a channel it cannot see" },
  { id: "fuse", num: 6, title: "Fuse", body: "Channels combine in a calibrated logistic model whose per term contributions are exposed in log odds, next to its intercept and calibration id.", receives: "channel scores", emits: "final_confidence and contributions", refuses: "an unexplained score" },
  { id: "geo", num: 7, title: "Geo", body: "Navigation maps a sonar frame position to a geographic fix with an uncertainty. Without navigation, position is null and the reason names the missing metadata.", receives: "frame position and navigation", emits: "latitude, longitude, uncertainty in metres", refuses: "a coordinate without navigation" },
  { id: "mission", num: 8, title: "Mission", body: "Contacts are ranked by a transparent recovery priority from a versioned weights file, and compared against prior surveys inside the new coverage polygon only.", receives: "fused detections", emits: "priority rank and change status", refuses: "claiming REMOVED outside coverage" },
  { id: "persist", num: 9, title: "Persist", body: "Operator verdicts, prior survey history and change records live in one append-only substrate, so comparison can run against human confirmed detections.", receives: "verdicts and detections", emits: "append-only review events", refuses: "overwriting a past judgement" },
];

export interface LevelRung {
  id: string;
  name: string;
  body: string;
}

export const LEVEL_LADDER: LevelRung[] = [
  { id: "L0", name: "Pixel only", body: "Intensity and image coordinates. No frame semantics recoverable." },
  { id: "L1", name: "Tile relative", body: "Ping order and nadir known. Range scale in metres is not." },
  { id: "L2", name: "Track relative", body: "Navigation derived along track geometry. Comparison becomes permissible." },
  { id: "L3", name: "Surveyed", body: "Absolute position with a stated uncertainty from navigation." },
];

export interface ChannelExplainer {
  title: string;
  tag: string;
  body: string;
  limit: string;
}

export const CHANNEL_EXPLAINERS: ChannelExplainer[] = [
  { title: "Acoustic shadow", tag: "RANGE ORDERING", body: "A raised object blocks sound behind it. The shadow must appear on the far side in range, at a length consistent with the object's implied height. The channel reports whether that ordering holds, plus contrast against local background and shadow continuity.", limit: "Not applicable when nadir is unrecoverable, because the direction of behind is then unknown." },
  { title: "Persistence", tag: "WINDOW OVERLAP", body: "Overlapping tiles give the same patch of seabed several independent looks. A real object holds position and speckle does not. Support is a Wilson score over observations against opportunities, with positional scatter in pixels.", limit: "Reported in pixels rather than metres whenever the range scale is unknown." },
  { title: "Range context", tag: "LOCAL BACKGROUND", body: "Backscatter statistics vary strongly with range from nadir, so a candidate is scored against its own range band rather than the whole frame, with clutter density recorded so a busy seabed is not read as many targets.", limit: "Degrades on frames with heavy attitude banding or dropout." },
  { title: "Open-set anomaly", tag: "OUT OF DISTRIBUTION", body: "A score for how unlike the training distribution a region is. High anomaly with no matching known class produces an unknown anomaly candidate that goes to a human rather than into a class bucket.", limit: "An anomaly score is not a probability of being debris. It is a distance from what was learned." },
  { title: "Calibrated fusion", tag: "LOG ODDS", body: "The channels enter a logistic model with a calibration stage. Per term contributions and the intercept are exposed for every detection, so a confidence can be read as an argument.", limit: "Refuses to render a confidence when the calibration artifact for the run is absent." },
];

export const OPERATOR_LOOP = [
  { tone: "var(--ice)", label: "MODEL PROPOSES", body: "Known detections and open-set candidates, each with its evidence channels." },
  { tone: "var(--mint)", label: "OPERATOR DECIDES", body: "Confirm, reject, relabel or mark uncertain, with notes." },
  { tone: "var(--amber)", label: "MEMORY RECORDS", body: "The event is appended, never overwritten, and tagged for training eligibility." },
  { tone: "var(--unknown)", label: "HUMANS RETRAIN", body: "A new model version is a deliberate, versioned act with its own evaluation." },
];

/**
 * Copy for the illustrative sonar swath animation. The animation is a drawing
 * of how a side-scan frame is organised. It contains no detections and no
 * measured values, and the caption on the page says so.
 */
export const SWATH_CAPTION =
  "Illustrative animation of side-scan frame geometry: port above nadir, starboard below, range increasing away from the centre line. It is drawn from procedural noise, not from survey imagery, and it contains no detections.";
