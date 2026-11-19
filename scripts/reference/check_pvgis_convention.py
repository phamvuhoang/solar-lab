#!/usr/bin/env python
"""Which instant does a PVGIS hourly timestamp denote? Compares PVGIS's own sun height (H_sun) with pvlib at shifted times.
Usage: .venv/bin/python check_pvgis_convention.py LAT LON YEAR [ALTITUDE_M]
Result for the bundled dataset: shift 0 min gives 0.07 deg mean error, +/-15 min gives ~3 deg, so the hh:30 stamp is the interval midpoint.
Only latitude, longitude and year are sent to the service."""
import json, sys, urllib.request
import numpy as np, pandas as pd, pvlib

lat, lon, year = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3])
alt = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
url = f"https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat={lat}&lon={lon}&startyear={year}&endyear={year}&pvcalculation=0&components=1&angle=0&aspect=0&outputformat=json&browser=0"
h = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "solar-lab-convention-check/1"}), timeout=60))["outputs"]["hourly"]
t = pd.to_datetime([x["time"] for x in h], format="%Y%m%d:%H%M", utc=True)
hs = np.array([x["H_sun"] for x in h])
day = hs > 5
for shift in (-30, -15, 0, 15, 30):
    sp = pvlib.solarposition.get_solarposition(t + pd.Timedelta(minutes=shift), lat, lon, altitude=alt, method="nrel_numpy")
    err = np.abs(sp["elevation"].to_numpy() - hs)[day]
    print(f"shift {shift:+3d} min: mean abs error {err.mean():.3f} deg")
