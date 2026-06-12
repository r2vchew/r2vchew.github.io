#!/usr/bin/env python3
"""Parse a weekly grocery-deals doc (markdown export from the Drive
"Claude/grocery-deals" folder) into a per-week JSON data file.

Usage:
    python3 scripts/grocery/parse_deals.py data/groceries/raw/2026-06-11.md

Writes data/groceries/<week_of>.json with metadata plus one record per deal:
    {store, price, unit, name, cat, badges: [{text, bonus}]}

Expected doc format:
    # Grocery deals - week of YYYY-MM-DD (deals valid YYYY-MM-DD to YYYY-MM-DD)
    ## Bonus points & rewards offers (N)     <- skipped, duplicates store items
    ## <Store> - <Loyalty program> (N)
    - $PRICE[/lb|/kg|/100g] [$REGULAR]  NAME [- PROMO NOTE]
"""
import json, re, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]

HEAD_RE = re.compile(
    r'^#\s*Grocery deals - week of (\d{4}-\d{2}-\d{2})'
    r'(?:\s*\(deals valid (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\))?')
STORE_RE = re.compile(r'^##\s+(.+?)\s*\((\d+)\)\s*$')
ITEM_RE = re.compile(
    r'^-\s+\$(\d+(?:\.\d+)?)(?:/(lb|kg|100\s?g))?'      # sale price (+unit)
    r'(?:\s+\$\d+(?:\.\d+)?(?:/(?:lb|kg|100\s?g))?)?'   # optional regular price, ignored
    r'\s\s*(.+)$')

# promo note detection: the text after the final " - " on a deal line
PROMO_RE = re.compile(
    r'(?i)(scene\+|\bpts\b|points|\bearn\b|\bmembers?\b|optimum|see flyer|'
    r'load my offers|% off|rewards|save (up to )?\d+%|save \$)')
# plain percentage discounts are not loyalty/bonus offers
PLAIN_SAVE_RE = re.compile(r'(?i)^save (up to )?\d+%$')

# ---------------- smart title-casing for ALL-CAPS store sections ----------------
SMALL = {'or', 'of', 'with', 'and', 'the', 'a', 'to', 'in', 'on', 'for', '&', 'x', 'per'}
ACRONYMS = {'PC', 'T&T', 'BBQ', 'USA', 'PTS', 'XL', 'BLT'}
UNIT_FIX = {'ML': 'mL', 'KG': 'kg', 'G': 'g', 'LB': 'lb', 'PKG': 'pkg'}

def _cap_part(part):
    if not part:
        return part
    lw = part.lower()
    # keep D'Italiano / O'Brien style prefixes capitalized on both sides
    m = re.match(r"^([a-z])'(.+)$", lw)
    if m and len(m.group(2)) > 2:
        return m.group(1).upper() + "'" + m.group(2)[0].upper() + m.group(2)[1:]
    return lw[0].upper() + lw[1:]

def smart_title(s):
    out = []
    for i, w in enumerate(s.split(' ')):
        core = w.strip('().,\'"')
        if core.lower() in SMALL and i != 0:
            out.append(w.lower() if w.isupper() else w)
        elif core in UNIT_FIX and not any(c.isdigit() for c in w):
            out.append(w.replace(core, UNIT_FIX[core]))
        elif core in ACRONYMS or any(c.isdigit() for c in w) or not w.isupper():
            out.append(w)
        else:
            # capitalize each hyphen/slash-separated piece: BAKEN-ETS -> Baken-Ets
            out.append(re.sub(r"[^/\-]+", lambda m: _cap_part(m.group(0)), w))
    return ' '.join(out)

def maybe_title(name):
    letters = [c for c in name if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.7:
        return smart_title(name)
    return name

# ---------------- categorization ----------------
# Stage 1: the original five broad buckets. Exact-substring overrides win,
# then pattern lists in order: frozen/prepared, meat, veggie, fruit.
OVERRIDE = {
    'BOCONCINI': 'other',
    'BOCCONCINI': 'other',
    'PORK & BEEF BURGERS': 'meat',
    'MEDIUM GROUND CHUCK BURGERS': 'meat',
    'TURKEY BURGERS': 'meat',
    'CANNED MUSHROOMS': 'other',
    'DRIED SHIITAKE MUSHROOMS': 'other',
    'CHOPPED TOMATOES': 'other',
    'TOMATO PASTE': 'other',
    'TOMATO SAUCE': 'other',
    'TOMATO KETCHUP': 'other',
    'NOODLE SOUP': 'other',
    'CANNED': 'other',
    'PASTA SALAD': 'frozen',
    'PASTA': 'other',
    'ENFAGROW': 'other',
    'CAPRICARE': 'other',
    'KABRITA': 'other',
    'MILKBONE': 'other',
    'CHICKEN BROTH': 'other',
    'MILKSHAKE': 'other',
    'PORK RINDS': 'other',
    'GROUND COFFEE': 'other',
    'WARBA NUGGET POTATOES': 'veggie',
    'HUMMUS': 'frozen',
    'PLANT-BASED YOGURT': 'other',
    'LITTLE POTATO CO': 'veggie',
}
FROZEN_PATTERNS = [
    r'\bICE CREAM\b', r'\bFROZEN\b', r'\bFRIES\b', r'\bONION RINGS\b',
    r'\bNUGGETS?\b', r'\bMOMOS\b', r'\bDUMPLINGS?\b', r'\bWONTON\b',
    r'\bKABOBS?\b', r'\bTACO (KIT|BOWL)\b', r'\bAL PASTOR\b', r'\bPIZZA\b',
    r'\bPUB RECIPE\b', r'\bBREADED\b', r'\bBATTERED\b', r'\bFISH BALLS?\b',
    r'\bSURIMI\b', r"\bSHRIMP D'OEUVRES\b", r'\bSHRIMP SKEWERS?\b',
    r'\bCREAM PIE\b', r'\bSHORTCAKE\b', r'\bCREAM CAKE\b',
    r'\bPLANT-BASED\b', r'\bCHICKEN BITES?\b', r'\bSTUFFED CHICKEN\b',
    r'\bCRISPY CHICKEN\b', r'\bROASTED CHICKEN\b', r'\bSALMON BURGERS?\b',
    r'\bSPECIALTY POTATOES\b', r'\bCAVENDISH\b', r'\bFROZEN VEGGIES\b',
    r'\bHIGH LINER\b', r'\bSEAQUEST\b', r'\bBOWL\b', r'\bTATAKI\b',
]
MEAT_PATTERNS = [
    r'\bCHICKEN\b', r'\bBEEF\b', r'\bPORK\b', r'\bTURKEY\b', r'\bHAM\b',
    r'\bBACON\b', r'\bSAUSAGES?\b', r'\bSALMON\b', r'\bFILLETS?\b',
    r'\bTUNA\b', r'\bCOD\b', r'\bHADDOCK\b', r'\bSOLE\b', r'\bMUSSELS\b',
    r'\bSTEAKS?\b', r'\bROASTS?\b', r'\bRIBS\b', r'\bWINGS\b',
    r'\bDRUMSTICKS\b', r'\bGROUND\b', r'\bTENDERLOIN\b', r'\bLOIN\b',
    r'\bSALAMI\b', r'\bPASTRAMI\b', r'\bCORNED BEEF\b', r'\bSMOKED MEAT\b',
    r'\bBURGERS?\b', r'\bDELI\b.*MEATS?\b', r'\bSLICED MEATS?\b',
    r'\bCOHO\b', r'\bSABLEFISH\b', r'\bWIENERS\b', r'\bLOX\b',
]
VEGGIE_PATTERNS = [
    r'\bONIONS?\b', r'\bBROCCOLI\b', r'\bPEPPERS?\b', r'\bLETTUCE\b',
    r'\bMUSHROOMS?\b', r'\bPOTATOES?\b', r'\bTOMATOES\b', r'\bCARROTS\b',
    r'\bSPINACH\b', r'\bGARLIC\b', r'\bGREEN BEANS\b', r'\bRADISHES\b',
    r'\bCUCUMBER\b', r'\bDAIKON\b', r'\bCABBAGE\b',
]
FRUIT_PATTERNS = [
    r'\bSTRAWBERRIES\b', r'\bGRAPES\b', r'\bAPPLES\b', r'\bBLUEBERRIES\b',
    r'\bCHERRIES\b', r'\bPINEAPPLE\b', r'\bAVOCADOS?\b', r'\bLEMONS\b',
    r'\bBANANAS\b', r'\bORANGES\b', r'\bPEACHES\b', r'\bMANGOS?\b',
]

def stage1(upper):
    for key, cat in OVERRIDE.items():
        if key in upper:
            return cat
    for pats, cat in ((FROZEN_PATTERNS, 'frozen'), (MEAT_PATTERNS, 'meat'),
                      (VEGGIE_PATTERNS, 'veggie'), (FRUIT_PATTERNS, 'fruit')):
        for pat in pats:
            if re.search(pat, upper):
                return cat
    return 'other'

# Stage 2a: split "meat" into beef / pork / chicken / seafood
SEAFOOD_PAT = [r'\bSALMON\b', r'\bCOHO\b', r'\bSABLEFISH\b', r'\bSHRIMP\b',
               r'\bSCALLOPS?\b', r'\bTUNA\b', r'\bCOD\b', r'\bHADDOCK\b',
               r'\bSOLE\b', r'\bMUSSELS?\b', r'\bLOX\b', r'\bCRAB\b', r'\bPRAWNS?\b']
CHICKEN_PAT = [r'\bCHICKEN\b', r'\bTURKEY\b', r'\bDRUMSTICKS?\b']
BEEF_PAT = [r'\bBEEF\b', r'\bSIRLOIN\b', r'\bSTRIP\s?LOIN\b', r'\bGRILLING STEAKS?\b',
            r'\bGROUND CHUCK\b', r'\bPRIME RIB\b', r'\bCORNED BEEF\b', r'\bPASTRAMI\b',
            r'\bSHORT RIB\b']

def split_meat(upper):
    for pats, cat in ((SEAFOOD_PAT, 'seafood'), (CHICKEN_PAT, 'chicken'),
                      (BEEF_PAT, 'beef')):
        for pat in pats:
            if re.search(pat, upper):
                return cat
    return 'pork'  # bacon/ham/sausages/etc. and the remaining generic cuts

# Stage 2b: split "other" into dairy / bakery / snacks / canned / other
NONFOOD_OVERRIDE = {
    'ENFAGROW': 'other', 'CAPRICARE': 'other', 'KABRITA': 'other',
    'MILKBONE': 'other', 'GARNIER': 'other', 'CAKE BEAUTY': 'other',
    'CRACKER BARREL': 'dairy', 'YOPLAIT': 'dairy',
}
SNACKS_PAT = [r'\bCHIPS?\b', r'\bCRACKERS?\b', r'\bPRETZELS?\b', r'\bPOPCORN\b',
              r'\bFRUIT SNACKS\b', r'\bSNACKS?\b', r'\bPORK RINDS\b', r'\bCHEETOS\b']
BAKERY_PAT = [r'\bBREAD\b', r'\bBUNS?\b', r'\bBAGELS?\b', r'\bCROISSANTS?\b',
              r'\bBRIOCHE\b', r'\bROLLS?\b', r'\bNAAN\b']
CANNED_PAT = [r'\bPASTA\b', r'\bRICE\b', r'\bCEREAL\b', r'\bSOUP\b', r'\bSAUCE\b',
              r'\bBROTH\b', r'\bFLOUR\b', r'\bOIL\b', r'\bCOFFEE\b', r'\bTEA\b',
              r'\bKETCHUP\b', r'\bOATMEAL\b', r'\bOATS\b', r'\bCANNED\b',
              r'\bCOCONUT MILK\b', r'\bCOCONUT CREAM\b', r'\bCONDENSED MILK\b',
              r'\bPODS\b', r'\bK-CUP\b', r'\bTOMATO PASTE\b', r'\bCHOPPED TOMATOES\b',
              r'\bATTA\b']
DAIRY_PAT = [r'\bYOGOURT\b', r'\bYOGURT\b', r'\bCHEESE\b', r'\bCHEDDAR\b',
             r'\bBUTTER\b', r'\bCREAM\b', r'\bEGGS?\b', r'\bMILK\b',
             r'\bOAT BEVERAGE\b', r'\bOAT BARISTA\b', r'\bBRIE\b']

def split_other(upper):
    for key, cat in NONFOOD_OVERRIDE.items():
        if key in upper:
            return cat
    for pats, cat in ((SNACKS_PAT, 'snacks'), (BAKERY_PAT, 'bakery'),
                      (CANNED_PAT, 'canned'), (DAIRY_PAT, 'dairy')):
        for pat in pats:
            if re.search(pat, upper):
                return cat
    return 'other'

def categorize(name):
    upper = name.upper()
    cat = stage1(upper)
    if cat == 'meat':
        return split_meat(upper)
    if cat == 'other':
        return split_other(upper)
    return cat

# ---------------- parsing ----------------
def parse(text):
    text = re.sub(r'\\(.)', r'\1', text)  # unescape markdown backslashes from Docs export
    meta = {'week_of': None, 'valid_from': None, 'valid_to': None}
    store = None
    items = []
    for line in text.splitlines():
        line = line.strip()
        m = HEAD_RE.match(line)
        if m:
            meta['week_of'], meta['valid_from'], meta['valid_to'] = m.groups()
            continue
        m = STORE_RE.match(line)
        if m:
            head = m.group(1)
            store = None if head.lower().startswith('bonus points') else head.split(' - ')[0].strip()
            continue
        m = ITEM_RE.match(line)
        if not m or store is None:
            continue
        price, unit, rest = float(m.group(1)), m.group(2) or '', m.group(3).strip()
        badges = []
        if ' - ' in rest:
            head_part, tail = rest.rsplit(' - ', 1)
            if PROMO_RE.search(tail):
                rest = head_part.strip()
                badges.append({'text': tail.strip(),
                               'bonus': not PLAIN_SAVE_RE.match(tail.strip())})
        name = maybe_title(rest)
        items.append({'store': store, 'price': price, 'unit': unit.replace(' ', ''),
                      'name': name, 'cat': categorize(name), 'badges': badges})
    return meta, items

def main():
    src = pathlib.Path(sys.argv[1])
    meta, items = parse(src.read_text())
    if not meta['week_of']:
        sys.exit('could not find week-of header in ' + str(src))
    meta['valid_from'] = meta['valid_from'] or meta['week_of']
    out = REPO / 'data' / 'groceries' / (meta['week_of'] + '.json')
    out.write_text(json.dumps({**meta, 'items': items}, indent=1, ensure_ascii=False))
    from collections import Counter
    print(f"{len(items)} items -> {out}")
    for cat, n in Counter(i['cat'] for i in items).most_common():
        print(f"  {cat}: {n}")
    print("  stores:", sorted({i['store'] for i in items}))

if __name__ == '__main__':
    main()
