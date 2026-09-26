# PID-02 water-column annotation instructions (protocol PID02-WCREF-v1)

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
