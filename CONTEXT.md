# Aqualens

Side-scan sonar analysis for seabed object search: detector observations are grouped into Contacts, supported by independent evidence, and decided by an analyst.

## Language

### Acquisition

**Upload**:
A set of files submitted together for processing. It may contain one or more Surveys, or unrelated Frames.
_Avoid_: survey (for the upload as a whole), bundle (when meaning its contents)

**Survey**:
One contiguous recording from one sonar during one pass.
_Avoid_: upload, dataset, mission

**Mission**:
An operational campaign that may contain several Surveys.
_Avoid_: survey, project

**Sensor**:
The specific sonar instrument that produced a Survey.
_Avoid_: dataset, domain (when meaning the instrument)

**Frame**:
One raster from a Survey, covering a window of consecutive pings.
_Avoid_: image, tile

**Ping**:
One transmit–receive cycle; one along-track row of a waterfall.
_Avoid_: line, scan

**Side**:
The port or starboard half of the swath, on either side of nadir.
_Avoid_: channel (when meaning port/starboard)

**Slant range**:
Distance along the acoustic path from the sonar to a seabed point; the across-track axis of a raw waterfall.
_Avoid_: range (unqualified), ground range, depth

**Look**:
An observation of seabed whose pings or frequency are disjoint from another Look. Overlapping windows of the same pings are one Look.
_Avoid_: view, frame, pass

### Detection and association

**Observation**:
One immutable detector output (class, raw detector confidence, box) on one Frame.
_Avoid_: finding, detection (in prose), target

**Contact**:
One physical-object hypothesis, supported by one or more Observations.
_Avoid_: target, object, track

**Persistence**:
Re-observation of a Contact in independent Looks.
_Avoid_: temporal tracking, window overlap, frame persistence

### Evidence

**Evidence channel**:
One source of support for a Contact that can be available or missing: detector, persistence, local anomaly, raised relief.
_Avoid_: feature, signal (when meaning a channel)

**Missing evidence**:
An evidence channel that could not be computed for a Contact; it neither supports nor counts against it.
_Avoid_: zero evidence, negative evidence

**Local Anomaly**:
A region statistically unusual relative to comparable seabed from the same Survey.
_Avoid_: unknown object, unknown artificial object, artificial anomaly, open-set detection

**Comparable seabed**:
Seabed from the same Survey and Side, at similar Slant range, excluding the candidate's own pings.
_Avoid_: background (unqualified), normal seabed, reference memory

**Raised-relief evidence**:
A far-range acoustic shadow consistent with something standing above the seabed.
_Avoid_: artificiality evidence, man-made evidence, shadow validation

**Raw detector confidence**:
The detector's uncalibrated class score for an Observation.
_Avoid_: probability, confidence (unqualified)

**Contact score**:
A validation-fitted combination of a Contact's available evidence channels; called calibrated only after held-out calibration evaluation passes.
_Avoid_: confidence (unqualified), normalized confidence, evidence score

### Review

**Analyst verdict**:
A human decision recorded on a Contact: confirmed, rejected, relabelled or uncertain. It is the only source of an "artificial" or "man-made" label.
_Avoid_: classification, ground truth

**Failed class**:
A supervised class whose held-out recall shows it is not operationally usable.
_Avoid_: experimental class, demo class
