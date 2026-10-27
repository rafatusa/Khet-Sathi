"""Builds the offline crop data used by lib/cropworld.js (v0.11.0). Run once; the outputs are committed.

Inputs (download first; all CC BY 4.0):
  MIRCA-OS v2 (Kebede et al., March 2026), https://www.hydroshare.org/resource/e4582ca0042148338bb5e0148b749ed6/
    "Crop Calendar/Gridded Crop Calendar.rar" unpacked to NetCDF/Rainfed/*.nc and NetCDF/Irrigated/*.nc
      (planting and maturity month per 5 arc-minute cell, only where the crop is grown)
    "Crop Calendar/MIRCA-OS_2020_rf_v2.csv" and "..._ir_v2.csv" (growing area per crop per district or state)
  FAOSTAT Crops and livestock products (QCL), bulk CSV, https://www.fao.org/faostat/en/#data/QCL
    Production_Crops_Livestock_E_All_Data_(Normalized).csv + Production_Crops_Livestock_E_AreaCodes.csv

Outputs (lib/data/):
  mirca-grid.bin        for each crop file and system, 10 x 10 degree blocks of bytes (planting month << 4 | maturity month),
                        each block deflated on its own so a lookup inflates only one small block
  mirca-units.json.gz   per country (ISO2): every district or state with the hectares and months of each crop
  faostat-crops.json    per country (ISO2): harvested hectares of each crop, mean of the last 3 years

Usage: python3 tools/build_crop_data.py <MIRCA-OS folder> <FAOSTAT folder>
"""
import csv, gzip, json, os, struct, sys, zlib
import numpy as np
import netCDF4
import pycountry

MIRCA, FAOS = sys.argv[1], sys.argv[2]
OUT = os.path.join(os.path.dirname(__file__), '..', 'lib', 'data')
# MIRCA-OS crop file -> app crop key (names in public/i18n.js and public/next/ks-text.js)
CROPS = [('Barley', 'barley'), ('Cassava', 'cassava'), ('Cotton', 'cotton'), ('Groundnuts', 'peanut'), ('Maize', 'maize'), ('Millet', 'millet'),
         ('Potatoes', 'potato'), ('Pulses', 'pulses'), ('Rapeseed', 'rapeseed'), ('Rice1', 'rice'), ('Rice2', 'rice'), ('Rice3', 'rice'), ('Rye', 'rye'),
         ('Sorghum', 'sorghum'), ('Soybeans', 'soybean'), ('Sugar_beet', 'sugar_beet'), ('Sugar_cane', 'sugarcane'), ('Sunflower', 'sunflower'),
         ('Wheat1', 'wheat'), ('Wheat2', 'wheat')]
CSV_NAME = {c.replace('_', ' '): (c, k) for c, k in CROPS}
SYSTEMS = ['Rainfed', 'Irrigated']
ROWS, COLS, BLOCK = 2160, 4320, 120  # 5 arc-minute grid, 10 degree blocks

# ---------- grids ----------
grids = []
blobs = bytearray()
index = []
for crop, key in CROPS:
    for system in SYSTEMS:
        f = netCDF4.Dataset(os.path.join(MIRCA, 'NetCDF', system, f'{crop}.nc'))
        p = np.nan_to_num(np.ma.filled(f['Planting_month'][:].astype('float32'), np.nan)).astype('uint8')
        m = np.nan_to_num(np.ma.filled(f['Maturity_month'][:].astype('float32'), np.nan)).astype('uint8')
        f.close()
        g = ((p & 15) << 4 | (m & 15)).astype('uint8')
        offs = []
        for br in range(ROWS // BLOCK):
            for bc in range(COLS // BLOCK):
                blk = g[br * BLOCK:(br + 1) * BLOCK, bc * BLOCK:(bc + 1) * BLOCK]
                if not blk.any():
                    offs.append([0, 0])
                    continue
                z = zlib.compress(blk.tobytes(), 9)
                offs.append([len(blobs), len(z)])
                blobs += z
        grids.append({'crop': crop, 'key': key, 'system': system[:2].lower()})
        index.append(offs)
head = json.dumps({'rows': ROWS, 'cols': COLS, 'block': BLOCK, 'res': 1 / 12, 'grids': grids, 'index': index}, separators=(',', ':')).encode()
with open(os.path.join(OUT, 'mirca-grid.bin'), 'wb') as o:
    o.write(struct.pack('<I', len(head)) + head + bytes(blobs))

# ---------- districts and states ----------
def iso_of(unit_code):
    m49 = int(unit_code) // 10000
    c = pycountry.countries.get(numeric=str(m49).zfill(3))
    return c.alpha_2 if c else None

units = {}
for system in ('rf', 'ir'):
    with open(os.path.join(MIRCA, f'MIRCA-OS_2020_{system}_v2.csv'), encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            if r['Crop'] not in CSV_NAME: continue
            try:
                area = float(r['Growing_area'] or 0)
                pm, mm = int(float(r['Planting_Month'])), int(float(r['Maturity_Month']))
            except ValueError:
                continue
            if area <= 0: continue
            iso = iso_of(r['unit_code'])
            if not iso: continue
            u = units.setdefault(iso, {}).setdefault(r['unit_code'], {'s': r['State'] or '', 'd': r.get('Distrct') or r.get('District') or '', 'c': {}})
            crop, key = CSV_NAME[r['Crop']]
            seasons = u['c'].setdefault(key, {})
            k = f'{crop}|{pm}|{mm}'
            seasons[k] = seasons.get(k, 0) + round(area)
out = {}
for iso, us in units.items():
    out[iso] = [{'s': u['s'], 'd': u['d'], 'c': {k: [[a, int(s.split('|')[1]), int(s.split('|')[2])] for s, a in sorted(v.items(), key=lambda kv: -kv[1])] for k, v in u['c'].items()}} for u in us.values()]
with gzip.open(os.path.join(OUT, 'mirca-units.json.gz'), 'wt', encoding='utf-8') as o:
    json.dump(out, o, separators=(',', ':'), ensure_ascii=False)

# ---------- FAOSTAT country totals (ranking where no district matches) ----------
FAO_ITEMS = {'56': 'maize', '15': 'wheat', '27': 'rice', '236': 'soybean', '44': 'barley', '270': 'rapeseed', '292': 'rapeseed',
             '116': 'potato', '83': 'sorghum', '79': 'millet', '242': 'peanut', '187': 'pulses', '176': 'pulses', '201': 'pulses', '191': 'pulses',
             '125': 'cassava', '328': 'cotton', '267': 'sunflower', '157': 'sugar_beet', '156': 'sugarcane', '71': 'rye'}
m49_iso = {}
with open(os.path.join(FAOS, 'Production_Crops_Livestock_E_AreaCodes.csv'), encoding='latin-1') as f:
    for r in csv.DictReader(f):
        c = pycountry.countries.get(numeric=r['M49 Code'].strip("'").zfill(3))
        if c: m49_iso[r['Area Code']] = c.alpha_2
# v0.12.0: yields (kg per hectare) for the harvest estimate, one key per crop the app can track.
YIELD_ITEMS = {**FAO_ITEMS, '187': 'pea', '176': 'beans', '201': 'lentil', '191': 'chickpea', '292': 'mustard', '358': 'cabbage',
               '393': 'cauliflower', '426': 'carrot', '394': 'bottle_gourd', '122': 'sweet_potato', '289': 'sesame', '397': 'cucumber'}
area, years, yarea, yprod = {}, set(), {}, {}
with open(os.path.join(FAOS, 'Production_Crops_Livestock_E_All_Data_(Normalized).csv'), encoding='latin-1') as f:
    for r in csv.DictReader(f):
        if r['Element Code'] in ('5312', '5510') and r['Item Code'] in YIELD_ITEMS and r['Area Code'] in m49_iso and int(r['Year']) >= 2019:
            try:
                v = float(r['Value'])
                tgt = yarea if r['Element Code'] == '5312' else yprod
                d = tgt.setdefault(m49_iso[r['Area Code']], {}).setdefault(YIELD_ITEMS[r['Item Code']], {})
                d[int(r['Year'])] = d.get(int(r['Year']), 0) + v
            except ValueError:
                pass
        if r['Element Code'] != '5312' or r['Item Code'] not in FAO_ITEMS or r['Area Code'] not in m49_iso: continue
        y = int(r['Year'])
        if y < 2019: continue
        try: v = float(r['Value'])
        except ValueError: continue
        years.add(y)
        a = area.setdefault(m49_iso[r['Area Code']], {}).setdefault(FAO_ITEMS[r['Item Code']], {})
        a[y] = a.get(y, 0) + v
last = sorted(years)[-3:]
countries = {}
for iso, crops in area.items():
    row = {k: round(sum(ys[y] for y in last if y in ys) / max(1, len([y for y in last if y in ys]))) for k, ys in crops.items()}
    row = {k: v for k, v in sorted(row.items(), key=lambda kv: -kv[1]) if v > 0}
    if row: countries[iso] = row
yields = {}
for iso, crops in yprod.items():
    for k, ys in crops.items():
        ha = sum(yarea.get(iso, {}).get(k, {}).get(y, 0) for y in last)
        t = sum(ys.get(y, 0) for y in last)
        if ha > 0 and t > 0: yields.setdefault(iso, {})[k] = round(t * 1000 / ha)
json.dump({'source': f'FAOSTAT Crops and livestock products, area harvested, mean of {last[0]}-{last[-1]} (FAO, CC BY 4.0)',
           'calendar': 'MIRCA-OS v2 crop calendars and growing areas, 2020, by district or state (Kebede et al. 2026, CC BY 4.0)',
           'years': last, 'countries': countries, 'yields': yields}, open(os.path.join(OUT, 'faostat-crops.json'), 'w'), separators=(',', ':'))
for n in ('mirca-grid.bin', 'mirca-units.json.gz', 'faostat-crops.json'):
    print(n, os.path.getsize(os.path.join(OUT, n)))
print('countries with districts or states:', len(out))
