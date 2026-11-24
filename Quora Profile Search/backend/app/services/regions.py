"""Region detection for free-text locations: United States ("US") or Europe ("EU").

"EU" here means geographic Europe as used by this app: EU/EEA countries, the UK, Switzerland and the
other European countries listed below (Russia and Turkey, which are transcontinental, are not included).
"""

import re

from .us_location import US_STATES, is_us_location

STATE_ABBR = list(US_STATES)

EUROPE_COUNTRIES = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Czechia", "Denmark", "Estonia", "Finland",
    "France", "Germany", "Deutschland", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
    "Malta", "Netherlands", "The Netherlands", "Holland", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
    "Spain", "Sweden", "United Kingdom", "UK", "U.K.", "England", "Scotland", "Wales", "Northern Ireland",
    "Great Britain", "Britain", "Switzerland", "Norway", "Iceland", "Liechtenstein", "Ukraine", "Serbia",
    "Bosnia and Herzegovina", "Bosnia", "Montenegro", "North Macedonia", "Macedonia", "Albania", "Kosovo", "Moldova",
    "Belarus", "Andorra", "Monaco", "San Marino", "Europe", "European Union",
]
EUROPE_CITIES = [
    "London", "Berlin", "Paris", "Amsterdam", "Madrid", "Barcelona", "Lisbon", "Porto", "Dublin", "Rome", "Milan",
    "Munich", "München", "Vienna", "Wien", "Zurich", "Zürich", "Geneva", "Stockholm", "Gothenburg", "Copenhagen",
    "Oslo", "Helsinki", "Warsaw", "Krakow", "Kraków", "Wroclaw", "Wrocław", "Prague", "Budapest", "Bucharest",
    "Athens", "Brussels", "Antwerp", "Hamburg", "Frankfurt", "Cologne", "Köln", "Stuttgart", "Düsseldorf", "Lyon",
    "Marseille", "Toulouse", "Edinburgh", "Glasgow", "Manchester", "Bristol", "Leeds", "Kyiv", "Kiev", "Lviv",
    "Belgrade", "Sofia", "Tallinn", "Riga", "Vilnius", "Zagreb", "Ljubljana", "Bratislava", "Valencia", "Seville",
    "Rotterdam", "Utrecht", "Eindhoven", "The Hague", "Luxembourg", "Reykjavik", "Valletta",
    "Nicosia", "Turin", "Bologna", "Florence", "Naples", "Gdansk", "Gdańsk", "Poznan", "Poznań", "Cluj", "Iasi",
    "Thessaloniki", "Malmö", "Aarhus", "Tampere", "Bern", "Basel", "Lausanne", "Graz", "Salzburg", "Ghent", "Leuven",
]
_EU_RE = re.compile(r"(?<![\w.])(" + "|".join(sorted({re.escape(x) for x in EUROPE_COUNTRIES + EUROPE_CITIES if x},
                                                     key=len, reverse=True)) + r")(?![\w])")
_US_ABBR = re.compile(r",\s*(" + "|".join(STATE_ABBR) + r")\b")
# Cities that share a name with a US town are only European when not followed by a US state ("Paris, TX")
_US_HOMONYM = re.compile(r"\b(?:london|paris|dublin|athens|berlin|rome|milan|vienna|manchester|bristol|"
                         r"birmingham|cambridge)\s*,\s*(?:" + "|".join(STATE_ABBR) + r")\b", re.I)
_CANADA = re.compile(r"\b(?:ontario|quebec|québec|british columbia|alberta|manitoba|nova scotia|canada)\b", re.I)

REGION_LABEL = {"US": "United States", "EU": "Europe"}


def region_of(text: str | None) -> str | None:
    """'US', 'EU', 'OTHER', or None when there is no location text."""
    if not text or not text.strip():
        return None
    if _CANADA.search(text):
        return "OTHER"
    if _US_HOMONYM.search(text) or _US_ABBR.search(text):
        return "US"
    if _EU_RE.search(text):
        # "New England", "New Jersey"… are US; the regex needs a whole-word match so "England" in
        # "New England" would still hit — guard it explicitly
        if re.search(r"\bnew england\b", text, re.I):
            return "US"
        return "EU"
    us = is_us_location(text)
    if us:
        return "US"
    return "OTHER"
