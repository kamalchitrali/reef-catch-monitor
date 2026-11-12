# Evaluation protocol

## Species identification

The installed classifier is a transparent regional-descriptor nearest-centroid baseline, not a general fish foundation model. It normalizes crop orientation and luminance, extracts tiled colour/edge descriptors, ranks the nearest learned species, and abstains as **Unknown / Needs review** when the best distance exceeds a threshold fitted without test data.

Prepare reviewed, tight single-fish crops with `image,species,group,split` columns. A group must identify the physical specimen or catch session, so near-duplicate photographs never cross train, validation, and test. Prefer multiple independent sites, dates, cameras, sizes, life stages, and photo contexts per species. Keep a final test set untouched until methods are frozen.

`python -m backend.train manifest.csv` reports, on the same held-out groups:

- forced nearest-centroid baseline metrics;
- abstaining pipeline accuracy, macro F1, macro precision/recall, and per-species support/precision/recall/F1;
- actual-by-predicted confusion matrix, including Unknown / Needs review;
- abstention rate and group/image counts.

Do not compare runs that use different test groups. Record the manifest hash, taxonomy version, code commit, model ID, and collection protocol in the research log. The generated model embeds its metrics and receives a content-derived model ID.

## Length estimation

The application implements the explicit ratio:

`fish pixels / reference pixels × reference centimeters`

It requires an overhead photograph with the reference and fish in the same plane. It stores method `ruler_ratio_v1`, normalized ruler/fish endpoints, perspective confirmation, physical length, estimated length, and signed error. Without calibration it records no photo length.

For evaluation, use independent physical measurements with the same anatomical endpoint convention and a CSV containing `estimated_cm,physical_cm,group`. Run `python -m backend.train --length-manifest lengths.csv`. Report sample/group counts, unusable-photo rate, MAE, signed error, and RMSE in centimeters, stratified by size and photo context where counts permit.

## Known failure cases

- unseen or visually similar species, hybrids, juveniles, damaged specimens, and taxonomic label errors;
- multiple/overlapping fish inside one crop, occlusion, blur, glare, colour cast, and background leakage;
- bent fish, hidden tail tips, short scale bars, thick/ambiguous ruler marks, camera tilt, lens distortion, and reference objects outside the fish plane;
- distribution shift between training regions, gear, markets/boats, cameras, and seasons.

No field accuracy is published in this repository because no representative labeled dataset or validated physical-length dataset was supplied. Synthetic/unit tests verify software behavior, not biological accuracy.
