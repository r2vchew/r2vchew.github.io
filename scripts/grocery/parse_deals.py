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
    'ENFAGROW': 'nonfood', 'CAPRICARE': 'nonfood', 'KABRITA': 'nonfood',
    'MILKBONE': 'nonfood', 'GARNIER': 'nonfood', 'CAKE BEAUTY': 'nonfood',
    'CRACKER BARREL': 'dairy', 'YOPLAIT': 'dairy',
}
# Items clearly not grocery food — filtered before any other categorization
NONFOOD_PAT = [
    # Household cleaning
    r'\bDETERGENT\b', r'\bLAUNDRY\b', r'\bFABRIC SOFTENER\b', r'\bDRYER SHEETS?\b',
    r'\bDISHWASHER\b', r'\bGARBAGE BAGS?\b', r'\bPAPER TOWELS?\b', r'\bTOILET PAPER\b',
    r'\bTISSUES?\b', r'\bFEBREZE\b', r'\bLYSOL\b', r'\bMR\.?\s*CLEAN\b',
    r'\bWINDEX\b', r'\bBLEACH\b', r'\bAIR FRESHENER\b', r'\bSCOTCH.BRITE\b',
    r'\bMOUTHWASH\b', r'\bFLOSS\b', r'\bSHAVING\b',
    # Personal care
    r'\bSHAMPOO\b', r'\bCONDITIONER\b', r'\bBODY WASH\b', r'\bDEODORANT\b',
    r'\bTOOTHPASTE\b', r'\bTOOTHBRUSH\b', r'\bSUNSCREEN\b', r'\bMOISTURIZER\b',
    r'\bSKINCARE\b', r'\bFACE WASH\b', r'\bMASCARA\b', r'\bLIPSTICK\b',
    r'\bFOUNDATION\b', r'\bMAKEUP\b', r'\bHAIR COLOU?R\b', r'\bDRY SHAMPOO\b',
    # Pet food / treats
    r'\bDOG FOOD\b', r'\bCAT FOOD\b', r'\bPET FOOD\b',
    r'\bDOG TREATS?\b', r'\bCAT TREATS?\b',
    r'\bPEDIGREE\b', r'\bPURINA\b', r'\bWHISKAS\b',
    # Diapers / baby gear
    r'\bDIAPERS?\b', r'\bPAMPERS\b', r'\bHUGGIES\b',
    # Pharmacy / supplements (specific terms only to avoid food false-positives)
    r'\bIBUPROFEN\b', r'\bACETAMINOPHEN\b', r'\bMELATONIN\b',
    r'\bFISH OIL\b', r'\bPROTEIN POWDER\b', r'\bCOLLAGEN SUPPLEMENT\b',
    r'\bOMEGA.?3\b', r'\bSUPPLEMENTS?\b',
]
DRINKS_PAT = [
    r'\bCOCA.COLA\b', r'\bCOKE\b', r'\bPEPSI\b', r'\bSPRITE\b', r'\b7UP\b',
    r'\bCANADA DRY\b', r'\bDR\.?\s*PEPPER\b', r'\bROOT BEER\b', r'\bGINGER ALE\b',
    r'\bGINGER BEER\b', r'\bFANTA\b', r'\bMOUNTAIN DEW\b',
    r'\bRED BULL\b', r'\bMONSTER ENERGY\b', r'\bGATORADE\b', r'\bPOWERADE\b',
    r'\bORANGE JUICE\b', r'\bAPPLE JUICE\b', r'\bCRANBERRY JUICE\b',
    r'\bGRAPE JUICE\b', r'\bGRAPEFRUIT JUICE\b', r'\bLEMONADE\b', r'\bICED TEA\b',
    r'\bSPARKLING WATER\b', r'\bSELTZER\b', r'\bPERRIER\b', r'\bSAN PELLEGRINO\b',
    r'\bKOMBUCHA\b',
    r'\bCIDER\b',
    r'\b(WINE|VIN BLANC|VIN ROUGE|ROSÉ|PROSECCO)\b',
    r'\b(GIN|VODKA|RUM|WHISKY|WHISKEY|BOURBON|SCOTCH|TEQUILA|BRANDY|RYES?)\b',
    r'\bMARGARITA MIX\b', r'\bCOCKTAIL MIX\b',
    r'\bBEER\b',
]
SNACKS_PAT = [
    r'\bCHIPS?\b', r'\bCRACKERS?\b', r'\bPRETZELS?\b', r'\bPOPCORN\b',
    r'\bFRUIT SNACKS\b', r'\bSNACKS?\b', r'\bPORK RINDS\b', r'\bCHEETOS\b',
    r'\bCHOCOLATE\b', r'\bCAND(Y|IES)\b', r'\bGUMMIES?\b', r'\bGUMMI\b',
    r'\bJELLY BEANS?\b', r'\bLICORICE\b', r'\bMARSHMALLOWS?\b',
    r'\bNUTS\b', r'\bALMONDS?\b', r'\bCASHEWS?\b', r'\bWALNUTS?\b',
    r'\bPECANS?\b', r'\bPISTACHIOS?\b', r'\bMIXED NUTS\b', r'\bTRAIL MIX\b',
    r'\bPEANUTS\b',
    r'\bGRANOLA BARS?\b', r'\bPROTEIN BARS?\b', r'\bCEREAL BARS?\b',
    r'\bJERKY\b',
    r'\bDORITOS\b', r'\bRUFFLES\b', r'\bPRINGLES\b',
]
BAKERY_PAT = [
    r'\bBREAD\b', r'\bBUNS?\b', r'\bBAGELS?\b', r'\bCROISSANTS?\b',
    r'\bBRIOCHE\b', r'\bROLLS?\b', r'\bNAAN\b', r'\bTORTILLAS?\b',
    r'\bDONUTS?\b', r'\bDOUGHNUTS?\b', r'\bMUFFINS?\b', r'\bSCONES?\b',
]
CANNED_PAT = [
    r'\bPASTA\b', r'\bRICE\b', r'\bCEREAL\b', r'\bSOUP\b', r'\bSAUCE\b',
    r'\bBROTH\b', r'\bFLOUR\b', r'\bOIL\b', r'\bCOFFEE\b', r'\bTEA\b',
    r'\bKETCHUP\b', r'\bOATMEAL\b', r'\bOATS\b', r'\bCANNED\b',
    r'\bCOCONUT MILK\b', r'\bCOCONUT CREAM\b', r'\bCONDENSED MILK\b',
    r'\bPODS\b', r'\bK-CUP\b', r'\bTOMATO PASTE\b', r'\bCHOPPED TOMATOES\b',
    r'\bATTA\b', r'\bNOODLES?\b',
    # Condiments, spreads, seasonings
    r'\bMUSTARD\b', r'\bMAYO(NNAISE)?\b', r'\bBBQ SAUCE\b', r'\bBARBECUE SAUCE\b',
    r'\bMARINADE\b', r'\bDRESSING\b', r'\bVINAIGRETTE\b', r'\bHOT SAUCE\b',
    r'\bSALSA\b', r'\bPEANUT BUTTER\b', r'\bNUT BUTTER\b',
    r'\bJAM\b', r'\bJELLY\b', r'\bMARMALADE\b', r'\bHONEY\b',
    r'\bSYRUP\b', r'\bMAPLE SYRUP\b', r'\bVINEGAR\b',
    r'\bSEASONING\b', r'\bSPICE\b', r'\bCURRY\b',
    r'\bSOY SAUCE\b', r'\bTERIYAKI\b', r'\bCHILI SAUCE\b',
    r'\bBINDAL?WA\b', r'\bSPREAD\b',
]
DAIRY_PAT = [r'\bYOGOURT\b', r'\bYOGURT\b', r'\bCHEESE\b', r'\bCHEDDAR\b',
             r'\bBUTTER\b', r'\bCREAM\b', r'\bEGGS?\b', r'\bMILK\b',
             r'\bOAT BEVERAGE\b', r'\bOAT BARISTA\b', r'\bBRIE\b']

def split_other(upper):
    for key, cat in NONFOOD_OVERRIDE.items():
        if key in upper:
            return cat
    for pats, cat in ((DRINKS_PAT, 'drinks'), (SNACKS_PAT, 'snacks'),
                      (BAKERY_PAT, 'bakery'), (CANNED_PAT, 'canned'), (DAIRY_PAT, 'dairy')):
        for pat in pats:
            if re.search(pat, upper):
                return cat
    return 'other'

def categorize(name):
    upper = name.upper()
    for pat in NONFOOD_PAT:
        if re.search(pat, upper):
            return 'nonfood'
    cat = stage1(upper)
    if cat == 'meat':
        return split_meat(upper)
    if cat == 'other':
        return split_other(upper)
    return cat

# ---------------- parsing ----------------
def parse(text):
    text = re.sub(r'\\(.)', r'\1', text)  # unescape markdown backslashes from Docs export
    text = re.sub(r'\*\*', '', text)       # strip bold markers from raw inventory files
    text = re.sub(r'~~([^~]*)~~', r'\1', text)  # strip strikethrough, keep inner text
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
    meta, items = parse(src.read_text(encoding='utf-8-sig'))
    if not meta['week_of']:
        sys.exit('could not find week-of header in ' + str(src))
    meta['valid_from'] = meta['valid_from'] or meta['week_of']
    out = REPO / 'data' / 'groceries' / (meta['week_of'] + '.json')
    out.write_text(json.dumps({**meta, 'items': items}, indent=1, ensure_ascii=False), encoding='utf-8')
    from collections import Counter
    print(f"{len(items)} items -> {out}")
    for cat, n in Counter(i['cat'] for i in items).most_common():
        print(f"  {cat}: {n}")
    print("  stores:", sorted({i['store'] for i in items}))

if __name__ == '__main__':
    main()
