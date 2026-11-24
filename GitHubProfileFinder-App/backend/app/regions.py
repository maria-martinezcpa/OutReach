"""World regions (UN M49 geoscheme sub-regions) and continents for countries.

A profile's region comes from its location text when that names a region itself ("Europe", "Southeast Asia"),
otherwise it is looked up from the detected country. Searching by region also accepts continents and a few
common groupings (Middle East, Latin America, Nordics, …).
"""

import re
from typing import Optional

import pycountry

# ISO 3166 alpha-2 codes per UN M49 sub-region.
_REGION_CODES: dict[str, str] = {
    "Northern Africa": "DZ EG LY MA SD TN EH",
    "Eastern Africa": "BI KM DJ ER ET KE MG MW MU YT MZ RE RW SC SO SS UG TZ ZM ZW IO TF",
    "Middle Africa": "AO CM CF TD CG CD GQ GA ST",
    "Southern Africa": "BW SZ LS NA ZA",
    "Western Africa": "BJ BF CV CI GM GH GN GW LR ML MR NE NG SH SN SL TG",
    "Caribbean": "AI AG AW BS BB BQ VG KY CU CW DM DO GD GP HT JM MQ MS PR BL KN LC MF VC SX TT TC VI",
    "Central America": "BZ CR SV GT HN MX NI PA",
    "South America": "AR BO BV BR CL CO EC FK GF GY PY PE GS SR UY VE",
    "Northern America": "BM CA GL PM US",
    "Central Asia": "KZ KG TJ TM UZ",
    "Eastern Asia": "CN HK MO KP JP MN KR TW",
    "South-eastern Asia": "BN KH ID LA MY MM PH SG TH TL VN",
    "Southern Asia": "AF BD BT IN IR MV NP PK LK",
    "Western Asia": "AM AZ BH CY GE IQ IL JO KW LB OM QA SA PS SY TR AE YE",
    "Eastern Europe": "BY BG CZ HU PL MD RO RU SK UA",
    "Northern Europe": "AX DK EE FO FI GG IS IE IM JE LV LT NO SJ SE GB",
    "Southern Europe": "AL AD BA HR GI GR VA IT MT ME MK PT SM RS SI ES XK",
    "Western Europe": "AT BE FR DE LI LU MC NL CH",
    "Australia and New Zealand": "AU NZ CX CC HM NF",
    "Melanesia": "FJ NC PG SB VU",
    "Micronesia": "GU KI MH FM NR MP PW UM",
    "Polynesia": "AS CK PF NU PN WS TK TO TV WF",
    "Antarctica": "AQ",
}

CONTINENT_OF_REGION: dict[str, str] = {
    "Northern Africa": "Africa", "Eastern Africa": "Africa", "Middle Africa": "Africa",
    "Southern Africa": "Africa", "Western Africa": "Africa",
    "Caribbean": "North America", "Central America": "North America", "Northern America": "North America",
    "South America": "South America",
    "Central Asia": "Asia", "Eastern Asia": "Asia", "South-eastern Asia": "Asia", "Southern Asia": "Asia",
    "Western Asia": "Asia",
    "Eastern Europe": "Europe", "Northern Europe": "Europe", "Southern Europe": "Europe", "Western Europe": "Europe",
    "Australia and New Zealand": "Oceania", "Melanesia": "Oceania", "Micronesia": "Oceania", "Polynesia": "Oceania",
    "Antarctica": "Antarctica",
}

REGIONS = list(_REGION_CODES)
CONTINENTS = sorted(set(CONTINENT_OF_REGION.values()) - {"Antarctica"})

# Common groupings people search for, as sets of countries (alpha-2) or whole regions.
GROUPS: dict[str, dict] = {
    "Middle East": {"regions": ["Western Asia"], "codes": {"EG", "IR"}},
    "Latin America": {"regions": ["Central America", "South America"], "codes": {"CU", "DO", "PR", "HT"}},
    "Nordics": {"codes": {"DK", "FI", "IS", "NO", "SE", "FO", "GL", "AX"}},
    "Scandinavia": {"codes": {"DK", "NO", "SE"}},
    "Baltics": {"codes": {"EE", "LV", "LT"}},
    "Balkans": {"codes": {"AL", "BA", "BG", "HR", "XK", "ME", "MK", "RO", "RS", "SI", "GR"}},
    "DACH": {"codes": {"DE", "AT", "CH"}},
    "Benelux": {"codes": {"BE", "NL", "LU"}},
    "European Union": {"codes": set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split())},
    "Gulf": {"codes": {"AE", "SA", "QA", "KW", "BH", "OM"}},
    "Sub-Saharan Africa": {"regions": ["Eastern Africa", "Middle Africa", "Southern Africa", "Western Africa"], "codes": {"SD"}},
    "Oceania": {"regions": ["Australia and New Zealand", "Melanesia", "Micronesia", "Polynesia"]},
}

_REGION_OF: dict[str, str] = {code: region for region, codes in _REGION_CODES.items() for code in codes.split()}

# Names the rest of the app displays for countries, mapped back to ISO codes.
_NAME_OVERRIDES = {
    "russia": "RU", "south korea": "KR", "north korea": "KP", "vietnam": "VN", "iran": "IR", "taiwan": "TW",
    "turkey": "TR", "syria": "SY", "bolivia": "BO", "venezuela": "VE", "tanzania": "TZ", "moldova": "MD",
    "laos": "LA", "palestine": "PS", "netherlands": "NL", "kosovo": "XK", "czechia": "CZ", "united states": "US",
    "united kingdom": "GB", "hong kong": "HK", "macau": "MO", "ivory coast": "CI", "cape verde": "CV",
    "brunei": "BN", "micronesia": "FM", "vatican": "VA", "eswatini": "SZ", "swaziland": "SZ",
    "dr congo": "CD", "democratic republic of the congo": "CD", "republic of the congo": "CG",
}


def _build_code_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for c in pycountry.countries:
        for n in (c.name, getattr(c, "official_name", None), getattr(c, "common_name", None)):
            if n:
                lookup[n.lower()] = c.alpha_2
    lookup.update(_NAME_OVERRIDES)
    return lookup


_CODE_OF = _build_code_lookup()

# Region names that people write in their location field, longest first.
_LOCATION_REGION_WORDS: list[tuple[str, str, Optional[str]]] = sorted(
    [(r.lower(), r, CONTINENT_OF_REGION[r]) for r in REGIONS]
    + [
        ("southeast asia", "South-eastern Asia", "Asia"), ("south east asia", "South-eastern Asia", "Asia"),
        ("east asia", "Eastern Asia", "Asia"), ("south asia", "Southern Asia", "Asia"),
        ("west africa", "Western Africa", "Africa"), ("east africa", "Eastern Africa", "Africa"),
        ("north africa", "Northern Africa", "Africa"), ("central africa", "Middle Africa", "Africa"),
        ("west europe", "Western Europe", "Europe"), ("east europe", "Eastern Europe", "Europe"),
        ("north america", "Northern America", "North America"), ("scandinavia", "Northern Europe", "Europe"),
        ("middle east", "Western Asia", "Asia"),
        ("latin america", None, "South America"), ("latam", None, "South America"),
        ("europe", None, "Europe"), ("africa", None, "Africa"), ("asia", None, "Asia"), ("oceania", None, "Oceania"),
        ("emea", None, None), ("apac", None, "Asia"),
    ],
    key=lambda x: len(x[0]),
    reverse=True,
)


def country_code(country: Optional[str]) -> Optional[str]:
    return _CODE_OF.get(country.strip().lower()) if country else None


def region_of_country(country: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(region, continent) for a country name, e.g. "Germany" -> ("Western Europe", "Europe")."""
    region = _REGION_OF.get(country_code(country) or "")
    return (region, CONTINENT_OF_REGION[region]) if region else (None, None)


def extract_region(location: Optional[str], country: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Region from the location text if it names one, otherwise calculated from the country."""
    region, continent = region_of_country(country)
    if region:
        return region, continent
    text = (location or "").lower()
    for words, reg, cont in _LOCATION_REGION_WORDS:
        if re.search(r"(?<![a-z])" + re.escape(words) + r"(?![a-z])", text):
            return reg, cont
    return None, None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def matches_region(query: str, region: Optional[str], continent: Optional[str], country: Optional[str]) -> bool:
    """Does a profile in (region, continent, country) belong to the searched region/continent/group?"""
    q = _norm(query)
    if not q:
        return True
    if region and _norm(region) == q or continent and _norm(continent) == q:
        return True
    # Friendly spellings: "Southeast Asia" for "South-eastern Asia", "North America" for "Northern America"…
    aliases = {_norm(w): r for w, r, _ in _LOCATION_REGION_WORDS if r}
    if q in aliases and region == aliases[q]:
        return True
    group = next((g for name, g in GROUPS.items() if _norm(name) == q), None)
    if group:
        code = country_code(country)
        return region in group.get("regions", []) or (code is not None and code in group.get("codes", set()))
    return False


def all_region_names() -> list[tuple[str, str]]:
    """(name, kind) for autocomplete."""
    return ([(c, "Continent") for c in CONTINENTS] + [(r, "Region") for r in REGIONS if r != "Antarctica"]
            + [(g, "Group of countries") for g in GROUPS if g not in CONTINENTS])
