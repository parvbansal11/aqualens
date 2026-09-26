# Epitome v2 demo navigation

The runtime copies each supplied `navigation.csv` latitude and longitude unchanged: CSV parser, frame record, finding, Contact, and map API all retain the same ordering. The prior Epitome v2 bundle placed its synthetic demo track at `18.921840, 72.834660` near the Gateway of India, so the fixture—not production coordinate handling—caused the shoreline placement.

Run `python scripts/build_epitome_v2_offshore_demo.py` to create the corrected internal ZIP at `data/runtime/demo/Aqualens_Epitome_v2_Offshore_Demo.zip`. It preserves the sonar rasters, names, ping order, and mission structure. Its track is a short, consistent line in the Arabian Sea west of Mumbai (`18.921840..18.922230`, `72.755000..72.755450`).

All coordinates in that ZIP are `SYNTHETIC_DEMO_METADATA`. They exist only for the internal demo, are not derived from sonar imagery, and are not field measurements or evaluation data.
