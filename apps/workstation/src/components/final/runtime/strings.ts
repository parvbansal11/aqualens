/* Authored copy. ENGINEERING_CONTRACT §11: this text is authored and must not be
 * generated, paraphrased or localized ad hoc. It is routed through this table
 * unchanged. Text that derives from backend state is built in select.ts. */

export const ROLES = [
  { id: "field", name: "Field Officer", question: "What should I inspect next?" },
  { id: "analyst", name: "Sonar Analyst", question: "What exactly did the system see, and why?" },
  { id: "supervisor", name: "Mission Supervisor", question: "What happened in this survey and what requires action?" },
  { id: "decision", name: "Decision Viewer", question: "What requires attention?" },
] as const;

export const TITLES = {
  upload: "What survey do you want analyzed?",
  processing: "Processing survey",
  processingDone: "Survey processed",
  processingFailed: "Survey processing failed",
  results: "What did we find?",
  map: "Where is it?",
  review: "Is this finding real?",
  mission: "What requires action?",
  lab: "How well does the system perform?",
  entry: "Turn sonar surveys into actionable marine findings.",
  landing: "From raw sonar to actionable marine findings.",
  permission: "This workspace does not include that view.",
} as const;

/* §5.4 — the processing view renders the phase list the backend publishes with
 * the job (sagar/api/jobs.py). These are the plain-language readings of each
 * phase id; a phase with no entry here falls back to the backend's own label,
 * so a new backend phase can never be silently dropped from the view. */
export const PHASE_COPY: Record<string, readonly [string, string]> = {
  upload_decoded: ["Upload decoded", "Reading the raster, or extracting the bundle, and confirming every image opens."],
  metadata_read: ["Survey metadata read", "Parsing and validating navigation.csv and mission.json, when the bundle carries them."],
  detector_ready: ["Frozen detector loaded", "Verifying the checkpoint digest and selecting the compute device."],
  inference: ["Detector inference", "Running the frozen detector over each source frame."],
  condition: ["Sonar condition assessed", "Measuring raster quality, dynamic range and dark-band extent per frame."],
  open_set: ["Open-set anomaly evidence", "Scoring each candidate's dissimilarity from the background reference memory."],
  contact_fusion: ["Contact fusion", "Associating detector observations into Contacts under the deterministic policy."],
  evidence: ["Evidence fusion and priority", "Combining the channels that are available and disclosing the ones that are not."],
  report: ["Report records prepared", "Writing the structured Contact and observation records."],
};

/* §5.7 — the four layer names and their fixed explanations. */
export const LAYER_NOTE: Record<string, readonly [string, string]> = {
  raw: ["Raw sonar", "As recorded, including speckle and shadow."],
  enhanced: ["Enhanced sonar", "A display-only contrast stretch. No filter is applied before inference."],
  detections: ["Detections", "Boxes mark raw detector candidates in the three known classes."],
  change: ["Change against a baseline", "Differences are marked only when a comparison against a baseline pass is supportable."],
};

export const LAYERS = [
  ["raw", "Raw"],
  ["enhanced", "Enhanced"],
  ["detections", "Detections"],
  ["change", "Change"],
] as const;

/* §3 — one fixed recommended-action sentence per recovery priority. These are
 * operational instructions, not risk predictions. Do not reword. */
export const ACTIONS: Record<string, string> = {
  High: "Inspect before recovery planning. Assign a diver or ROV pass to this sector.",
  Review: "Needs an analyst decision. Position cannot be issued to a field team yet.",
  Medium: "Record in the hazard register. No immediate field action.",
  Low: "Known infrastructure. Carry forward as a baseline reference.",
};

/* §3 — fixed evidence wording. Retained for the plain-language review flow;
 * the analyst evidence ladder states each channel from its real value instead. */
export const EVIDENCE = {
  memory:
    "Analyst verdicts are appended to this survey's history and bucketed as training memory for a future supervised round. Nothing is retrained by recording one.",
} as const;

export const UNAVAILABLE = {
  locationTitle: "Location unavailable",
  locationBody:
    "This recording does not contain sufficient navigation metadata to produce latitude and longitude. The finding is still reviewable in the sonar workspace.",
  dimensionsTitle: "Dimensions unavailable",
  dimensionsBody:
    "Dimensions unavailable: no range scale in this recording. Extent is reported in source pixels only.",
  noPositionAtAll: "No finding in this survey carries a position.",
  baselineTitle: "No previous pass to compare",
  baselineBody:
    "This survey has no baseline pass, so change against a previous survey is not computed. Absence here is not a removal.",
  changeLayer: "No previous pass covers this window.",
  windowTitle: "Sonar window unavailable for this finding",
  prCurveTitle: "Precision against recall unavailable",
  prCurveBody:
    "The frozen evaluation run publishes summary metrics only. No precision-recall curve is recorded for it, and none is drawn from an inferred shape.",
  openSetTitle: "Open-set evaluation unavailable",
  openSetBody:
    "The frozen evaluation run does not publish held-out open-set measurements. Unknown is not a supervised class in this snapshot.",
  teamTitle: "Team assignment not connected",
  teamBody: "No assignment source is connected to this deployment, so no people are listed.",
  coverageTitle: "Coverage geometry unavailable",
  coverageBody:
    "No navigation records accompany this survey, so no vessel track, coverage swath or surveyed area can be drawn. Absence here is not a removal.",
  noEvaluationRun: "No evaluation run is published for this model version.",
  actionWithoutContact:
    "This raw observation was not fused into a Contact, so no recommended action is derived for it. Inspect it in the sonar workspace.",
} as const;

/* §6 — coverage caveats. Where absence could be misread as safety. */
export const CAVEATS = {
  emptyFindings:
    "The frozen detector proposed no candidate in the imagery that was read. That is not a statement that the area is clear, and it says nothing about object types the detector was never trained on.",
  notSurveyed: "Outside the new coverage polygon. Absence here is not a removal.",
} as const;

export const COPY = {
  landingEyebrow: "Side-scan sonar analysis",
  landingSub:
    "Aqualens reads side-scan sonar surveys, proposes seafloor contacts with a frozen detector, shows the evidence behind each one, and produces a reviewable, traceable record your team can act on.",
  entrySub: "Choose your workspace. The same survey data is behind all four.",
  entryDisclaimer:
    "Prototype. Findings come from a real local detector run against the raster you upload. Nothing is simulated.",
  uploadSub: "Drop a sonar raster, or add a prepared bundle of rasters.",
  dropzoneTitle: "Upload sonar survey",
  dropzoneLine: "Sonar images, or a prepared bundle of sonar images.",
  dropzoneExtensions: ".png .jpg .jpeg · .pbm · .zip",
  requirementsTitle: "What the system needs",
  advancedCaution:
    "These are fixed properties of this deployment's inference path, shown so a reviewer can see them. They are not adjustable here: changing them would change what the report is entitled to claim.",
  processingFoot:
    "Every state on this screen is reported by the analysis service after the work it names has happened. No completion figure is estimated.",
  resultsComplete: "Survey complete",
  findingsHint: "Highest priority first",
  contactsHint: "Undecided first, then by available evidence",
  observationsHint: "Raw detector output, unchanged",
  contactsNote:
    "A Contact is the operational object: one or more raw detector observations associated by the deterministic fusion policy. Its evidence score is UNVALIDATED_EVIDENCE_FUSION over the channels that were available for it, not a probability that the contact is real.",
  observationsNote:
    "These are the raw detector observations a Contact is built from. Class and confidence are exactly what the frozen detector emitted; nothing on this list has been re-scored, merged or suppressed.",
  reviewNote:
    "The queue advances on decision. Each verdict is appended to this survey's history and bucketed into a named training-memory queue for a future supervised round. Nothing is retrained by recording one.",
  reviewMemoryClosed:
    "Every finding in this survey has an analyst decision. Those decisions are now append-only training memory; the detector that produced them is unchanged.",
  reportReady: "Survey report ready",
  reportNotReady: "Report available when review closes",
  reportHonesty:
    "Findings without navigation records are exported with null coordinates and a machine-readable reason, never a substituted value.",
  shareDisabled: "Sharing is not enabled for this deployment",
  formatsAvailable:
    "JSON and CSV are the formats this deployment produces. There is no PDF generator here, so none is offered.",
  reportLimits:
    "The evidence score is UNVALIDATED_EVIDENCE_FUSION over available channels, not a calibrated probability. An open-set anomaly score is distance from a background reference memory, not proof a contact is artificial. SHIPWRECK presentation is demo-only and never production qualified. Absence of a contact is not a statement that an area is clear.",
  labHonesty:
    "Every figure here traces to one evaluation run. Findings in the workspace are produced by the model version named below, not by a newer unpublished one.",
  labCaveat:
    "A class is listed here when it has been evaluated, not when it happens to appear in the loaded survey.",
  openSetIntro:
    "An open-set evaluation would need a held-out set of object types the detector was never trained on. This snapshot has none, so no open-set detection rate is claimed.",
  openSetRuntimeNote:
    "Open-set v1 is nevertheless available at runtime as advisory evidence: a PatchCore-style distance from a memory of background patches taken from the training split, thresholded at the q99.5 value of validation-split background. Because the threshold was calibrated on background only, no AUROC, TPR or FPR against artificial targets is claimed, and a high score means dissimilar to that reference background — not artificial.",
  registryIntro:
    "What is actually loaded on the analysis host right now, and the limit each component operates under. An unavailable component contributes nothing; it is never substituted for and never assumed present.",
  reviewLineage:
    "Expert reviews become structured knowledge for future model improvement. They are recorded against the run that produced the finding and are excluded from the evaluation split.",
  evidenceScoreCaveat:
    "The evidence score combines only the channels that were available for this contact. It is an unvalidated evidence score, not a probability that the contact is real.",
  observationsInContact:
    "These raw detector observations were associated into this Contact. Each one keeps its own class, confidence and box exactly as the detector emitted them.",
  techCaption:
    "Values trace to the evaluation run recorded in the Model Lab. Expert reviews become structured knowledge for future model improvement.",
  demoPolicy:
    "INTERNAL DEMO ONLY, not production calibration. The displayed class and confidence for this finding come from the presentation policy, not from the detector. The raw model values above are unchanged.",
  claims: [
    [
      "It keeps the detector's own answer intact",
      "The frozen detector's class, confidence and box are recorded once and never rewritten. Sonar condition, acoustic verification, open-set evidence, fusion and analyst review are added beside them, each with its own provenance.",
    ],
    [
      "It says what it could not measure",
      "An evidence channel that is unavailable is reported as unavailable and excluded from the evidence score. Nothing missing is scored as zero, and no absence is read as an all-clear.",
    ],
    [
      "It hands you a record",
      "Every finding leaves the system as JSON or CSV, with its position when navigation supplied one, its extent, the raw detector confidence and its full review history.",
    ],
  ] as const,
  pipeline: [
    ["Survey vessel or AUV", "A side-scan sonar sweeps the seafloor."],
    ["Sonar imagery", "The along-track acoustic image reaches this system as a raster, with an optional navigation record."],
    ["Candidate detected", "The frozen detector proposes candidates in three known classes."],
    ["Contact and evidence", "Observations are fused into a Contact and scored on the evidence actually available."],
    ["Map position", "A supplied navigation record places the frame. Without one, position stays unavailable."],
    ["Report record", "The contact leaves as JSON or CSV, with its provenance."],
  ] as const,
} as const;

export const BUTTONS = {
  trySurvey: "Try a survey",
  howItWorks: "See how it works",
  chooseWorkspace: "Choose a workspace",
  uploadNewSurvey: "Upload new survey",
  backToOverview: "Back to overview",
  chooseFiles: "Choose files",
  processSurvey: "Process survey",
  advancedOpen: "Advanced processing options",
  advancedClose: "Hide advanced processing options",
  retry: "Retry",
  backToUpload: "Back to upload",
  downloadReport: "Download report",
  startReview: "Start review queue",
  showOnMap: "Show on map",
  openWorkspace: "Open in sonar workspace",
  sendToReview: "Send to review",
  map: "Map",
  techOpen: "View technical evidence",
  techClose: "Hide technical evidence",
  provenanceOpen: "View provenance & methodology",
  provenanceClose: "Hide provenance & methodology",
  processingDetailsOpen: "View processing details",
  processingDetailsClose: "Hide processing details",
  openQueue: "Open review queue",
  generateReport: "Generate survey report",
  viewFindings: "View findings",
  why: "Why?",
  whyClose: "Hide reasoning",
  share: "Share with survey desk",
  newSurvey: "New survey",
  changeWorkspace: "Change workspace",
  backToFindings: "Back to findings",
  openMemory: "See where these decisions go",
} as const;

export const VERDICT_BUTTONS = [
  ["Confirmed", "C", "CONFIRMED"],
  ["Rejected", "R", "REJECTED"],
  ["Relabelled", "L", "RELABELLED"],
  ["Uncertain", "U", "UNCERTAIN"],
] as const;

/* Plain-language "why it was flagged", authored per canonical class and selected
 * by class exactly the way ACTIONS is selected by priority.
 *
 * SCIENTIFIC WORDING: the frozen detector is a learned pattern matcher. It does
 * not measure hard returns, shadow geometry or material. So each sentence states
 * what the system actually did -- matched this window to one of its three known
 * classes -- and points at the evidence ladder for what could be measured. None
 * of these sentences asserts a property of the seabed. */
export const WHY: Record<string, string> = {
  PIPELINE:
    "The frozen detector matched this window to its PIPELINE class. That is a learned pattern match, not an acoustic measurement: what could actually be measured here is reported separately as acoustic verification.",
  WRECK_OR_STRUCTURAL_DEBRIS:
    "The frozen detector matched this window to its SHIPWRECK class. Recall for that class is the weakest of the three in the frozen evaluation, and its presentation in this build is demo-only, so an analyst decision matters most here.",
  DERELICT_FISHING_GEAR:
    "The frozen detector matched this window to its CRAB_POT class, which this product presents as derelict fishing gear. That is a learned pattern match, not a determination of what the object is made of.",
  ENGINEERING_STRUCTURE:
    "This class is not emitted by the frozen detector in this build, so no detector reasoning is available for it.",
  UNKNOWN_ANOMALY_CANDIDATE:
    "The detector emitted a class this build does not recognise, so no class name is displayed for it. Its raw class and confidence are unchanged and shown in the evidence below.",
};
