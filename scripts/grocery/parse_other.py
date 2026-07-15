#!/usr/bin/env python3
"""Parse the "Other deals" doc (Canadian Tire + non-food items pulled
alongside groceries) into a JSON data file, same idea as parse_deals.py.

Usage:
    python3 scripts/grocery/parse_other.py data/others/raw/2026-07-03.md

Writes data/others/<pulled>.json with metadata plus one record per deal:
    {store, price, unit, name, cat, badges: [{text, bonus}]}

Expected doc format (written by grocery-deals/build_other_doc.ps1):
    # Other deals - pulled YYYY-MM-DD
    ## Bonus points & rewards offers (N)     <- skipped, duplicates store items
    ## <Store> - <Loyalty program> (N)
    - $PRICE[/lb|/kg|/100g] [$REGULAR]  NAME [- PROMO NOTE]
"""
import json, re, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from parse_deals import STORE_RE, ITEM_RE, PROMO_RE, maybe_title

HEAD_RE = re.compile(r'^#\s*Other deals - pulled (\d{4}-\d{2}-\d{2})')
WEEK_RE = re.compile(r'^Week:\s*(\d{4}-\d{2}-\d{2})\s*\((current|preview)\)', re.IGNORECASE)

# ---------------- categorization ----------------
# Non-food items folded in from the grocery pull - same rough groupings as
# NONFOOD_PAT in parse_deals.py, just split into named buckets instead of one
# flat "nonfood" catch-all, since this page is dedicated to showing them.
BABY_PAT = [
    r'\bDIAPERS?\b', r'\bPAMPERS\b', r'\bHUGGIES\b', r'\bSWIM DIAPERS?\b', r'\bTRAINING PANTS\b',
    r'\bBOOSTER\b', r'\bCAR SEATS?\b(?!\s*COVER)', r'\bSAFETY GATE\b', r'\bPLAYHOUSES?\b',
]
PHARMACY_PAT = [
    r'\bIBUPROFEN\b', r'\bACETAMINOPHEN\b', r'\bMELATONIN\b', r'\bSENSODYNE\b', r'\bTHERABREATH\b',
    r'\bFISH OIL\b', r'\bPROTEIN POWDER\b', r'\bCOLLAGEN SUPPLEMENT\b', r'\bOMEGA.?3\b', r'\bSUPPLEMENTS?\b',
]
PERSONAL_CARE_PAT = [
    r'\bSHAMPOO\b', r'\bCONDITIONER\b', r'\bBODY WASH\b', r'\bDEODORANT\b',
    r'\bTOOTHPASTE\b', r'\bTOOTHBRUSH\b', r'\bSUNSCREEN\b', r'\bMOISTURIZER\b',
    r'\bSKINCARE\b', r'\bFACE WASH\b', r'\bMASCARA\b', r'\bLIPSTICK\b',
    r'\bFOUNDATION\b', r'\bMAKEUP\b', r'\bHAIR COLOU?R\b', r'\bDRY SHAMPOO\b', r'\bNAIR\b',
]
CLEANING_PAT = [
    r'\bDETERGENT\b', r'\bLAUNDRY\b', r'\bFABRIC SOFTENER\b', r'\bDRYER SHEETS?\b',
    r'\bDISHWASHER\b', r'\bGARBAGE BAGS?\b', r'\bPAPER TOWELS?\b', r'\bTOILET PAPER\b',
    r'\bTISSUES?\b', r'\bFEBREZE\b', r'\bLYSOL\b', r'\bMR\.?\s*CLEAN\b', r'\bKABOOM\b',
    r'\bWINDEX\b', r'\bBLEACH\b', r'\bAIR FRESHENER\b', r'\bSCOTCH.BRITE\b',
    r'\bMOUTHWASH\b', r'\bFLOSS\b', r'\bSHAVING\b', r'\bCLEANING\b',
]
PET_PAT = [
    r'\bDOG FOOD\b', r'\bCAT FOOD\b', r'\bPET FOOD\b', r'\bDOG TREATS?\b', r'\bCAT TREATS?\b',
    r'\bPEDIGREE\b', r'\bPURINA\b', r'\bWHISKAS\b', r'\bIAMS\b', r'\bBLUE BUFFALO\b', r'\bMILKBONE\b',
    r'\bDOG\b', r'\bCAT\b',
]

# Canadian Tire departments - inferred from name keywords since Flipp doesn't
# expose per-item department metadata for CT any more than it does for grocery.
AUTOMOTIVE_PAT = [
    r'\bWINDSHIELD\b', r'\bWIPER BLADES?\b', r'\bMOTOR OIL\b', r'\bANTIFREEZE\b', r'\bCAR (WASH|WAX|CARE|PROTECTANTS?)\b',
    r'\bTIRES?\b', r'\bBATTERY CHARGERS?\b', r'\bCAR BATTERY\b', r'\bAUTOMOTIVE\b', r'\bJUMP STARTERS?\b',
    r'\bFLOOR MATS?\b', r'\bROOF (RACK|BOX)\b', r'\bTOW(ING)?\b', r'\bTRAILER HITCH\b', r'\bCAR VACUUM\b',
    r'\bDASH ?CAM\b', r'\bMOTOMASTER\b', r'\bBUG WASH\b', r'\bWASHER FLUID\b',
    r'\bBRAKE CLEANER\b', r'\bFUEL (AND|&) ENGINE TREATMENTS?\b', r'\bENGINE TREATMENTS?\b',
    r'\bSTABILIZERS?\b', r'\bINJECTION CLEANERS?\b', r'\bGARAGE DOOR LUBE\b', r'\b3-IN-ONE\b',
    r'\bTIE DOWN\b', r'\bRECOVERY STRAPS?\b', r'\bBUNGEE\b', r'\bSTOOL, CREEPER\b', r'\bCREEPER\b',
    r'\bCOOLANTS?\b', r'\bDRIVEWAY\b', r'\bBRAKE PADS?\b', r'\bBRAKE ROTORS?\b', r'\bSEAT COVERS?\b',
    r'\bCAR (LOCK )?GPS\b', r'\bAXLE STANDS?\b', r'\bWHEEL CHOCK\b', r'\bOBD ?2\b', r'\bRAMPS?\b',
    r'\bTOWABLES?\b', r'\bCAR COVERS?\b', r'\bMAINTENANCE RAMPS?\b',
]
TOOLS_PAT = [
    r'\bHAND TOOLS?\b', r'\bPOWER TOOLS?\b', r'\bDRILL\b', r'\bSAW\b', r'\bSCREWDRIVER\b', r'\bWRENCH(ES)?\b',
    r'\bSOCKET SETS?\b', r'\bTOOL (SET|BOX|STORAGE|CHEST)\b', r'\bMASTERCRAFT\b', r'\bLADDER\b',
    r'\bTAPE MEASURE\b', r'\bPAINTING TAPE\b', r'\bDUCT TAPE\b', r'\bUTILITY TAPE\b', r'\bFOIL TAPE\b',
    r'\bLEVEL\b', r'\bHAMMERS?\b', r'\bPLIERS\b', r'\bCLAMPS?\b', r'\bAIR COMPRESSORS?\b', r'\bAIR TOOLS?\b',
    r'\bADHESIVE\b', r'\bGLUE\b', r'\bFOAM INSULATION\b', r'\bROTARY TOOL\b', r'\bPENETRANT\b', r'\bGREASE\b',
    r'\bWORK GLOVES\b', r'\bMULTIMETER\b', r'\bSHOP LIGHTS?\b', r'\bINFLATOR\b', r'\bIMPACT DRIVER\b',
    r'\bORBIT SANDER\b', r'\bMULTI-TOOL\b', r'\bTAP (AND|&) DIE SET\b', r'\bPOLISHER\b', r'\bDEWALT\b',
]
GARDEN_PAT = [
    r'\bFERTILIZER\b', r'\bGRASS SEED\b', r'\bTOP ?SOIL\b', r'\bBLACK EARTH\b', r'\bMULCH\b',
    r'\bGARDEN\b', r'\bLAWN\b', r'\bTURF BUILDER\b', r'\bPLANTERS?\b', r'\bPRUNERS?\b', r'\bHOSES?\b',
    r'\bSPRINKLERS?\b', r'\bNOZZLES?\b', r'\bSHEARS\b', r'\bWEED\b', r'\bSOIL\b', r'\bSCOTTS\b',
    r'\bSHOVELS?\b', r'\bRAKES?\b',
]
OUTDOOR_REC_PAT = [
    r'\bPOOL NOODLES?\b', r'\bPOOLS?\b', r'\bWADING POOLS?\b', r'\bCAMPING\b', r'\bCAMP CHAIRS?\b',
    r'\bTENTS?\b', r'\bSLEEPING BAGS?\b', r'\bBOATS?\b', r'\bMARINE\b', r'\bFENDERS?\b', r'\bFLAGPOLES?\b',
    r'\bKAYAKS?\b', r'\bCANOES?\b', r'\bFISHING\b', r'\bBIKES?\b', r'\bBICYCLES?\b', r'\bPATIO\b',
    r'\bHAMMOCKS?\b', r'\bCOOLERS?\b', r'\bBBQ\b', r'\bGRILLS?\b', r'\bPROPANE\b', r'\bLAWN CHAIRS?\b',
    r'\bBUBBLE WAND\b', r'\bFOLDING CHAIRS?\b', r'\bBEACH\b', r'\bTARPS?\b', r'\bGOLF\b',
    r'\bBASKETBALLS?\b', r'\bSTREET HOCKEY\b', r'\bFIELD SPORTS\b', r'\bCOURT SPORTS\b',
    r'\bAIR RIFLES?\b', r'\bAIR PISTOLS?\b', r'\bWATER BOTTLES?\b', r'\bCOMBO LOCKS?\b',
    r'\bLIFE JACKETS?\b', r'\bPFDS?\b', r'\bAIR BEDS?\b', r'\bCAMP STOVES?\b', r'\bCANOPY\b',
    r'\bSHELTERS?\b', r'\bDARTBOARDS?\b', r'\bBADMINTON\b', r'\bBOCCE\b', r'\bINLINE SKATES?\b',
    r'\bTACKLE\b', r'\bRODS?,? ?REELS?\b', r'\bSPINNING.*COMBOS?\b', r'\bFIRE PITS?\b',
    r'\bHELMETS?\b', r'\bJACKETS?\b', r'\bWAGONS?\b', r'\bLUGGAGE\b', r'\bDUMBBELLS?\b',
    r'\bINFLATABLE\b', r'\bTUBES?\b', r'\bCHLORINAT(ING|ED)\b', r'\bZERO GRAVITY CHAIRS?\b',
    r'\bUMBRELLAS?\b',
]
SEASONAL_PAT = [
    r'\bSPARKLERS?\b', r'\bFIREWORKS?\b', r'\bCHRISTMAS\b', r'\bHALLOWEEN\b', r'\bORNAMENTS?\b',
    r'\bPARTY\b', r'\bBALLOONS?\b', r'\bLIGHTERS?\b',
]
ELECTRONICS_PAT = [
    r'\bLED\b', r'\bFLASHLIGHTS?\b', r'\bHEADLAMPS?\b', r'\bBATTERIES\b', r'\bBATTERY PACKS?\b',
    r'\bCOIN CELL\b', r'\bDETECTION LIGHTS?\b', r'\bSTRIP LIGHTS?\b', r'\bPUCK LIGHTS?\b',
    r'\bSPEAKERS?\b', r'\bEARBUDS?\b', r'\bPOWER BANKS?\b', r'\bPOWER BARS?\b', r'\bINVERTERS?\b',
    r'\bAUDIO\b', r'\bCOMMUNICATION EQUIPMENT\b', r'\bLIGHT BULBS?\b', r'\bEXTENSION CORDS?\b',
    r'\bSOLAR LIGHTING\b', r'\bSOLAR .*LIGHT\b', r'\bWALL SCONCES?\b', r'\bFLUSH MOUNTS?\b',
]
HOME_PAT = [
    r'\bSTORAGE CONTAINERS?\b', r'\bSTORAGE TOTES?\b', r'\bCLARITY\b', r'\bBAKING SHEETS?\b',
    r'\bCOOKWARE\b', r'\bBAKEWARE\b', r'\bBAR MOPS?\b', r'\bTOWELS?\b', r'\bBEDDING\b', r'\bPILLOWS?\b',
    r'\bBLANKETS?\b', r'\bCUTLERY\b', r'\bFLATWARE\b', r'\bDINNERWARE\b', r'\bMASTER CHEF\b',
    r'\bKITCHEN\b', r'\bBUCKETS?\b', r'\bPLUMBSHOP\b', r'\bPLUNGERS?\b', r'\bFILTRATION CARTRIDGES?\b',
    r'\bRAINFRESH\b', r'\bFURNITURE\b', r'\bRUGS?\b', r'\bCURTAINS?\b', r'\bFRYPANS?\b', r'\bTOASTERS?\b',
    r'\bOVEN MITTS?\b', r'\bCUTTING BOARDS?\b', r'\bKNIFE SETS?\b', r'\bSCISSORS\b', r'\bSHARPENERS?\b',
    r'\bSERVINGWARE\b', r'\bSPICE RACKS?\b', r'\bGRINDERS?\b', r'\bFOOD STORAGE\b', r'\bGARBAGE CANS?\b',
    r'\bSIDE TABLES?\b', r'\bFOLDING STOOLS?\b', r'\bUTILITY CARTS?\b', r'\bSHOE STORAGE\b',
    r'\bMANDOLINE\b', r'\bGLASS FOOD STORAGE\b', r'\bFANS?\b', r'\bVACS?\b', r'\bVACUUMS?\b',
    r'\bBLENDERS?\b', r'\bFOOD PROCESSORS?\b', r'\bMIXERS?\b', r'\bCOFFEEMAKERS?\b', r'\bMICROWAVES?\b',
    r'\bBAR STOOLS?\b', r'\bOFFICE CHAIRS?\b', r'\bCABINETS?\b', r'\bFAUCETS?\b', r'\bWATER FILTERS?\b',
    r'\bFIRE EXTINGUISHERS?\b', r'\bSTEAM MOP\b', r'\bCARPET.*CLEANER\b', r'\bKETTLES?\b',
    r'\bBREAD MAKER\b', r'\bSTOCK POTS?\b', r'\bCOOKSETS?\b', r'\bDEHUMIDIFIERS?\b', r'\bAIR PURIFIERS?\b',
    r'\bSHOWER HEADS?\b', r'\bTOILETS?\b', r'\bSHELVES\b', r'\bRACKS?\b', r'\bSTORAGE RACKS?\b',
    r'\bCEILING FANS?\b',
]
PEST_CLEANING_PAT = [
    r'\bOVEN CLEANER\b', r'\bWATER SOFTENER\b', r'\bMICROFIBRE CLOTHS?\b', r'\bINSECT REPELLENT\b',
    r'\bWASP\b', r'\bHORNET\b', r'\bRAID\b', r"\bOFF!\b", r'\bBUG SPRAY\b',
]

# The three liquor stores (exact Flipp merchant names, from pull-liquor.ps1).
# Everything they sell is booze, so items from these stores are routed to the
# alcohol sub-categorizer below rather than the general non-food ruleset.
LIQUOR_STORES = {
    'Sobeys & Safeway Liquor',
    'Co-op Wine Spirits Beer Liquor',
    'Real Canadian Liquor Store',
}

# ---- alcohol sub-categories (beer / wine / sparkling / spirits / coolers) ----
# ORDER MATTERS. Ready-to-drink coolers & cocktails are checked FIRST because
# their names almost always contain a base-spirit or beer word ("Tequila
# Margarita", "Vodka Soda", "Pabst ... Iced Tea") that would otherwise mis-file
# them as spirits/beer. Then cider->beer, beer, sparkling (prosecco/brut before
# generic wine words), wine, and finally spirits. Anything from a liquor store
# that matches nothing lands in 'alcohol_other' (never the household 'other').
# Traps deliberately avoided: bare ESTATE (Appleton Estate rum vs Peller Estates
# wine -> use ESTATES plural) and bare AMBER (amber rum vs amber ale).
COCKTAIL_PAT = [
    r'\bCOCKTAILS?\b', r'\bMARGARITAS?\b', r'\bMOJITOS?\b', r'\bCAESARS?\b', r'\bSANGRIA\b',
    r'\bSPRITZ\b', r'\bMIMOSAS?\b', r'\bBELLINIS?\b', r'\bPALOMA\b', r'\bDAIQUIRIS?\b',
    r'\bPINA COLADA\b', r'\bCOSMOPOLITAN\b', r'\bTRANSFUSION\b', r'\bLONG DRINK\b',
    r'\bAPPERITIVO\b', r'\bAPERITIVO\b', r'\bSELTZER\b', r'\bCOOLERS?\b',
    r'\bVODKA SODA\b', r'\bSODA VARIETY\b', r'\bHARD\b', r'\bSPIKED\b', r'\bICED TEA\b',
    r'\bTWISTED TEA\b', r'\bWHITE CLAW\b', r'\bTRULY\b', r'\bNUTRL\b', r'\bVIZZY\b',
    r'\bBUZZBALLZ\b', r'\bCUTWATER\b', r'\bSMIRNOFF ICE\b', r'\bPALM BAY\b',
    r'\bCOTTAGE SPRINGS?\b', r'\bSVNS\b', r'\bHOOP TEA\b', r'\bHEY Y', r'\bMIKE.?S HARD\b',
    r'\bSOCIAL LITE\b', r'\bTHE FINNISH\b', r'\bSTRONG ICED\b', r'\bLEMONADE\b',
]
CIDER_PAT = [
    r'\bCIDER\b', r'\bNO BOATS ON SUNDAY\b', r'\bSTRONGBOW\b', r'\bSOMERSBY\b',
    r'\bANGRY ORCHARD\b', r'\bGROWERS\b', r'\bTHATCHERS\b', r'\bMAGNERS\b', r'\bREKORDERLIG\b',
]
BEER_PAT = [
    r'\bBEER\b', r'\bLAGERS?\b', r'\bALE\b', r'\bIPA\b', r'\bPILSN?ER\b', r'\bPILS\b',
    r'\bSTOUT\b', r'\bPORTER\b', r'\bRADLER\b', r'\bPALE ALE\b', r'\bDRAFT\b', r'\bDRAUGHT\b',
    r'\bBREW(ING|ERY|ED|S)?\b', r'\bHAZY\b', r'\bKOLSCH\b', r'\bSAISON\b', r'\bWITBIER\b',
    r'\bBOCK\b', r'\bHOP\b', r'\bBUDWEISER\b', r'\bBUD LIGHT\b', r'\bCOORS\b', r'\bCORONA\b',
    r'\bBUSCH\b', r'\bHEINEKEN\b', r'\bMICHELOB\b', r'\bMOOSEHEAD\b', r'\bOLD MILWAUKEE\b',
    r'\bSAPPORO\b', r'\bPERONI\b', r'\bSTELLA\b', r'\bGUINNESS\b', r'\bKOKANEE\b',
    r'\bMOLSON\b', r'\bLABATT\b', r'\bMILLER\b', r'\bMODELO\b', r'\bRED STRIPE\b',
    r'\bKEYSTONE\b', r'\bALBERTA GENUINE\b', r'\bBAVARIA\b', r'\bSUPER BOCK\b', r'\bCARLSBERG\b',
    r'\bBIG ROCK\b', r'\bMARDA LOOP\b', r'\bWILD ROSE\b', r'\bTOOL SHED\b', r'\bPUMPHOUSE\b',
    r'\bPHILLIPS\b', r'\bTROLLEY 5\b', r'\bORIGINAL 16\b', r'\bDRIFTWOOD\b',
    r'\bINNIS (&|AND) GUNN\b', r'\bPABST\b', r'\bSLEEMAN\b',
]
SPARKLING_PAT = [
    r'\bPROSECCO\b', r'\bCHAMPAGNE\b', r'\bCAVA\b', r'\bBRUT\b', r'\bSPUMANTE\b',
    r'\bSPARKLING\b', r'\bSEKT\b', r'\bCREMANT\b', r'\bFREIXENET\b', r'\bSEGURA VIUDAS\b',
]
WINE_PAT = [
    r'\bCABERNET\b', r'\bSAUVIGNON\b', r'\bMERLOT\b', r'\bSHIRAZ\b', r'\bSYRAH\b',
    r'\bMALBEC\b', r'\bPINOT\b', r'\bGRIGIO\b', r'\bGRIS\b', r'\bCHARDONNAY\b',
    r'\bRIESLING\b', r'\bCHIANTI\b', r'\bROSSO\b', r'\bROS[EÉ]\b', r'\bBLANC\b',
    r'\bGEW[UÜ]RZTRAMINER\b', r'\bTEMPRANILLO\b', r'\bSANGIOVESE\b', r'\bZINFANDEL\b',
    r'\bGRENACHE\b', r'\bMOSCATO\b', r'\bMUSCAT\b', r'\bBORDEAUX\b', r'\bBURGUNDY\b',
    r'\bCHENIN\b', r'\bVIOGNIER\b', r'\bTORRONTES\b', r'\bCARMENERE\b', r'\bPRIMITIVO\b',
    r'\bNEBBIOLO\b', r'\bBAROLO\b', r'\bVALPOLICELLA\b', r'\bTOSCANA\b', r'\bRED BLEND\b',
    r'\bWHITE BLEND\b', r'\bVINTNER\b', r'\bCELLARS?\b', r'\bVINEYARDS?\b', r'\bESTATES\b',
    r'\b(RED|WHITE) WINE\b', r'\bWINE\b', r'\bRH[OÔ]NE\b', r'\bROUGE\b', r'\bGAVI\b',
    r'\bBAROSSA\b', r'\bBODACIOUS\b', r'\bJACKSON.?TRIGGS\b', r'\bYELLOW TAIL\b',
    r'\bCASILLERO\b', r'\bCONO SUR\b', r'\bWOLF BLASS\b', r'\bNAKED GRAPE\b', r'\bBASK\b',
    r'\bTRIVENTO\b', r'\bMER SOLEIL\b', r'\bHONEST LOT\b', r'\bMASI\b', r'\bGRAY MONK\b',
    r'\bSANDHILL\b', r'\bGRANT BURGE\b', r'\bMICHAEL DAVID\b', r'\bXOXO\b',
]
SPIRITS_PAT = [
    r'\bVODKA\b', r'\bWHISK(E)?Y\b', r'\bRUM\b', r'\bGIN\b', r'\bTEQUILA\b', r'\bBOURBON\b',
    r'\bSCOTCH\b', r'\bBRANDY\b', r'\bCOGNAC\b', r'\bRYE\b', r'\bLIQUEUR\b', r'\bSINGLE MALT\b',
    r'\bMEZCAL\b', r'\bREPOSADO\b', r'\bA[NÑ]EJO\b', r'\bSCHNAPPS\b',
    r'\bVERMOUTH\b', r'\bABSINTHE\b', r'\bGRAPPA\b', r'\bAMARETTO\b', r'\bTRIPLE SEC\b',
    r'\bCOINTREAU\b', r'\bGRAND MARNIER\b', r'\bFIREBALL\b', r'\bMALIBU\b', r'\bJAGERMEISTER\b',
    r'\bBAILEYS\b', r'\bCAPTAIN MORGAN\b', r'\bCROWN ROYAL\b', r'\bDEWAR', r'\bAUCHENTOSHAN\b',
    r'\bGLENLIVET\b', r'\bGLENFIDDICH\b', r'\bMACALLAN\b', r'\bBACARDI\b', r'\bDILLON\b',
]

def categorize_alcohol(name):
    upper = name.upper()
    for pats, cat in (
        (COCKTAIL_PAT, 'cocktails'), (CIDER_PAT, 'beer'), (BEER_PAT, 'beer'),
        (SPARKLING_PAT, 'sparkling'), (WINE_PAT, 'wine'), (SPIRITS_PAT, 'spirits'),
    ):
        for pat in pats:
            if re.search(pat, upper):
                return cat
    return 'alcohol_other'

def categorize_other(name, store=None):
    if store in LIQUOR_STORES:
        return categorize_alcohol(name)
    upper = name.upper()
    for pats, cat in (
        (BABY_PAT, 'baby'), (PHARMACY_PAT, 'pharmacy'),
        (PERSONAL_CARE_PAT, 'personal_care'), (CLEANING_PAT, 'cleaning'),
        (PEST_CLEANING_PAT, 'cleaning'), (PET_PAT, 'pet'),
        (AUTOMOTIVE_PAT, 'automotive'), (TOOLS_PAT, 'tools'), (GARDEN_PAT, 'garden'),
        (OUTDOOR_REC_PAT, 'outdoor_rec'), (SEASONAL_PAT, 'seasonal'),
        (ELECTRONICS_PAT, 'electronics'), (HOME_PAT, 'home'),
    ):
        for pat in pats:
            if re.search(pat, upper):
                return cat
    return 'other'

# ---------------- parsing ----------------
def parse(text):
    text = re.sub(r'\\(.)', r'\1', text)
    text = re.sub(r'\*\*', '', text)
    text = re.sub(r'~~([^~]*)~~', r'\1', text)
    meta = {'pulled': None, 'week_of': None, 'week_label': None}
    store = None
    items = []
    for line in text.splitlines():
        line = line.strip()
        m = HEAD_RE.match(line)
        if m:
            meta['pulled'] = m.group(1)
            continue
        m = WEEK_RE.match(line)
        if m:
            meta['week_of'] = m.group(1)
            meta['week_label'] = m.group(2).lower()
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
                               'bonus': not re.match(r'(?i)^save (up to )?\d+%$', tail.strip())})
        name = maybe_title(rest)
        items.append({'store': store, 'price': price, 'unit': unit.replace(' ', ''),
                      'name': name, 'cat': categorize_other(name, store), 'badges': badges})
    return meta, items

def main():
    src = pathlib.Path(sys.argv[1])
    meta, items = parse(src.read_text(encoding='utf-8-sig'))
    if not meta['pulled']:
        sys.exit('could not find "pulled" header in ' + str(src))
    if not meta['week_of']:
        # Older docs (pre week-tagging) have no "Week: ..." line - best-effort
        # fallback so they still render, just without preview/current distinction.
        meta['week_of'] = meta['pulled']
        meta['week_label'] = 'current'
    out = REPO / 'data' / 'others' / (meta['pulled'] + '.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({**meta, 'items': items}, indent=1, ensure_ascii=False), encoding='utf-8')
    from collections import Counter
    print(f"{len(items)} items -> {out}")
    for cat, n in Counter(i['cat'] for i in items).most_common():
        print(f"  {cat}: {n}")
    print("  stores:", sorted({i['store'] for i in items}))

if __name__ == '__main__':
    main()
