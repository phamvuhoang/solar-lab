#!/usr/bin/env python
"""pvlib reference for the Solar Lab PV engine. Engineering tool only: not part of the user's runtime path.

Writes tests/fixtures/reference/*.json holding the SAME inputs the TypeScript engine reads plus pvlib's outputs and versions.
Model (both sides): sun at interval midpoint (NREL SPA, apparent zenith), isotropic transposition, Faiman cell temperature,
PVWatts-style linear DC, no IAM/spectral/shading, no losses, no limits.

Run:  scripts/reference/run.sh
"""
import hashlib
import json
import platform
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "reference"
U0, U1, ALBEDO, TEMP_REF = 25.0, 6.84, 0.2, 25.0
REFRACTION_TEMP_C = 12  # same constant as the TS engine


def pvlib_chain(times, lat, lon, alt, ghi, dni, dhi, temp, wind, tilt, az, pstc, gamma, n_panels):
    pressure = pvlib.atmosphere.alt2pres(alt)
    sp = pvlib.solarposition.get_solarposition(times, lat, lon, altitude=alt, pressure=pressure, temperature=REFRACTION_TEMP_C, method="nrel_numpy")
    poa = pvlib.irradiance.get_total_irradiance(tilt, az, sp["apparent_zenith"], sp["azimuth"], dni=dni, ghi=ghi, dhi=dhi, albedo=ALBEDO, model="isotropic")
    tcell = pvlib.temperature.faiman(poa["poa_global"], temp, wind, u0=U0, u1=U1)
    pdc = n_panels * pvlib.pvsystem.pvwatts_dc(poa["poa_global"], tcell, pstc, gamma, temp_ref=TEMP_REF)
    r = lambda s: [round(float(x), 4) for x in s]
    return {
        "pressurePa": round(float(pressure), 3),
        "apparentZenithDeg": r(sp["apparent_zenith"]), "azimuthDeg": r(sp["azimuth"]),
        "poaWm2": r(poa["poa_global"]), "tcellC": r(tcell), "pdcW": r(pdc),
    }


def meta():
    return {
        "pvlib": pvlib.__version__, "numpy": np.__version__, "pandas": pd.__version__, "python": platform.python_version(),
        "generatedBy": "scripts/reference/pvlib_reference.py",
        "models": {"solarPosition": "pvlib nrel_numpy (SPA), apparent zenith", "transposition": "isotropic", "cellTemperature": f"faiman u0={U0} u1={U1}",
                   "dc": "pvwatts_dc linear", "albedo": ALBEDO, "refractionTempC": REFRACTION_TEMP_C},
    }


def synthetic_cases():
    """Cloudy-clear days (Ineichen, Linke turbidity 3, deterministic cloud factors) at 4 seasons, 4 sites/orientations."""
    sites = {
        "lamha": (11.87, 108.2, 978.0), "hanoi": (21.03, 105.85, 10.0), "sydney": (-33.87, 151.2, 20.0),
    }
    plan = [
        ("lamha_south_tilt10", "lamha", 10, 180), ("lamha_east_tilt30", "lamha", 30, 90), ("lamha_west_tilt30", "lamha", 30, 270),
        ("lamha_north_tilt15", "lamha", 15, 0), ("hanoi_south_tilt20", "hanoi", 20, 180), ("sydney_north_tilt30", "sydney", 30, 0),
    ]
    days = ["2023-03-20", "2023-06-21", "2023-09-22", "2023-12-21"]
    pstc, gamma, n_panels = 620.0, -0.0029, 8
    r2 = lambda a: [round(float(x), 3) for x in a]
    cases = []
    for cid, site, tilt, az in plan:
        lat, lon, alt = sites[site]
        loc = pvlib.location.Location(lat, lon, altitude=alt)
        segments, mids = [], []
        for d in days:  # days are NOT contiguous, so each is its own regular series (segment)
            idx = pd.date_range(f"{d} 00:00", periods=24, freq="h", tz="UTC")
            mid = idx + pd.Timedelta(minutes=30)  # interval midpoints
            cs = loc.get_clearsky(mid, model="ineichen", linke_turbidity=3.0)
            k = np.arange(24) + 24 * len(segments)
            cloud = 0.35 + 0.65 * (0.5 + 0.5 * np.sin(k * 0.7))  # deterministic 0.35..1.0
            dni = cs["dni"].to_numpy() * cloud
            dhi = cs["dhi"].to_numpy() * (0.6 + 0.4 * cloud)
            ghi = cs["ghi"].to_numpy() * (0.3 + 0.7 * cloud)
            temp = 22 + 8 * np.sin((k % 24 - 8) / 24 * 2 * np.pi)
            wind = 1.0 + 0.5 * (k % 5)
            segments.append({"t0": int(idx[0].timestamp()), "stepSeconds": 3600, "ghi": r2(ghi), "dni": r2(dni), "dhi": r2(dhi), "tempAirC": r2(temp), "windMs": r2(wind)})
            mids.append(mid)
        # feed pvlib exactly the rounded values the fixture stores, so both sides see identical inputs
        cat = lambda key: np.concatenate([s_[key] for s_ in segments])
        mid_all = mids[0].append(mids[1:])
        S = lambda key: pd.Series(cat(key), mid_all)
        ref = pvlib_chain(mid_all, lat, lon, alt, S("ghi"), S("dni"), S("dhi"), S("tempAirC"), S("windMs"), tilt, az, pstc, gamma, n_panels)
        cases.append({
            "id": cid, "description": f"{site} tilt {tilt} azimuth {az}; 4 separate days (equinoxes/solstices), hourly, interval-mean input; reference arrays are the 4 days concatenated",
            "location": {"latitude": lat, "longitude": lon, "elevationM": alt},
            "model": {"tiltDeg": tilt, "azimuthDeg": az, "albedo": ALBEDO, "faimanU0": U0, "faimanU1": U1, "gamma": gamma, "pstcW": pstc, "nPanels": n_panels},
            "segments": segments, "reference": ref,
        })
    return cases


def year_case():
    """Full 2023 PVGIS-ERA5 hourly series for the Lâm Hà dataset, read from the same CSV the TypeScript engine reads."""
    path = ROOT / "data" / "weather" / "lam-ha-2023-pvgis-era5.csv"
    raw = path.read_bytes()
    df = pd.read_csv(path, comment="#", parse_dates=["timestamp_utc"])
    meta_lines = {l[2:].split(":", 1)[0]: l.split(":", 1)[1].strip() for l in raw.decode().splitlines() if l.startswith("# ") and ":" in l}
    lat, lon, alt = float(meta_lines["latitude"]), float(meta_lines["longitude"]), float(meta_lines["elevation_m"])
    assert meta_lines["timestamp_convention"] == "mid", "timestamps are interval midpoints: the sun is evaluated exactly there"
    mid = pd.DatetimeIndex(df["timestamp_utc"])
    tilt, az, pstc, gamma, n_panels = 10, 180, 620.0, -0.0029, 8
    s = lambda c: pd.Series(df[c].to_numpy(), mid)
    ref = pvlib_chain(mid, lat, lon, alt, s("ghi_wm2"), s("dni_wm2"), s("dhi_wm2"), s("temp_air_c"), s("wind_ms"), tilt, az, pstc, gamma, n_panels)
    ref["annualKWh"] = round(float(np.sum(ref["pdcW"]) / 1000.0), 4)  # hourly mean power × 1 h
    return {
        "id": "lamha_2023_pvgis_south_tilt10", "inputFile": "data/weather/lam-ha-2023-pvgis-era5.csv", "inputSha256": hashlib.sha256(raw).hexdigest(),
        "location": {"latitude": lat, "longitude": lon, "elevationM": alt},
        "model": {"tiltDeg": tilt, "azimuthDeg": az, "albedo": ALBEDO, "faimanU0": U0, "faimanU1": U1, "gamma": gamma, "pstcW": pstc, "nPanels": n_panels},
        "reference": ref,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    m = meta()
    (OUT / "synthetic.json").write_text(json.dumps({"meta": m, "cases": synthetic_cases()}, separators=(",", ":")) + "\n")
    (OUT / "lam-ha-2023.json").write_text(json.dumps({"meta": m, **year_case()}, separators=(",", ":")) + "\n")
    print("pvlib", m["pvlib"], "python", m["python"], "->", OUT)


if __name__ == "__main__":
    sys.exit(main())
