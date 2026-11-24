"""Deterministic helpers for deciding whether a free-text location is in the United States."""

import re

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia", "PR": "Puerto Rico",
}
US_CITIES = {
    "new york city", "nyc", "los angeles", "san francisco", "bay area", "silicon valley", "seattle", "boston",
    "chicago", "austin", "houston", "dallas", "denver", "atlanta", "miami", "philadelphia", "phoenix",
    "san diego", "san jose", "portland", "brooklyn", "manhattan", "washington, d.c.", "washington dc",
    "pittsburgh", "minneapolis", "detroit", "nashville", "raleigh", "salt lake city", "las vegas",
}
US_COUNTRY = re.compile(r"\b(united states(?: of america)?|usa)\b|\bu\.s\.(a\.)?", re.I)
STATE_ABBR = re.compile(r",\s*(" + "|".join(US_STATES) + r")\b")
# Places that share a US state name; if these appear, don't assume US.
AMBIGUOUS_NON_US = re.compile(r"\b(georgia \(country\)|tbilisi|new south wales|western australia|"
                              r"perth|victoria, (bc|british columbia|australia)|ontario|quebec)\b", re.I)
STATE_NAMES = re.compile(r"\b(" + "|".join(re.escape(v) for v in US_STATES.values()) + r")\b", re.I)


def is_us_location(text: str | None) -> bool | None:
    """True if clearly US, False if clearly another place, None if unknown/empty."""
    if not text or not text.strip():
        return None
    t = text.strip()
    if AMBIGUOUS_NON_US.search(t):
        return False
    if US_COUNTRY.search(t) or STATE_ABBR.search(t) or t.upper() in US_STATES:
        return True
    low = t.lower()
    if any(c in low for c in US_CITIES) or STATE_NAMES.search(t):
        return True
    return False
