import pycountry
import pytest

from app.contacts import extract_country
from app.regions import extract_region, matches_region, region_of_country


def test_every_country_has_a_region():
    missing = [c.name for c in pycountry.countries if region_of_country(c.name) == (None, None)]
    assert missing == []


@pytest.mark.parametrize("location, region, continent", [
    ("Berlin, Germany", "Western Europe", "Europe"),
    ("Austin, TX", "Northern America", "North America"),
    ("Lagos", "Western Africa", "Africa"),
    ("Taipei", "Eastern Asia", "Asia"),
    ("Pristina, Kosovo", "Southern Europe", "Europe"),
    ("Dubai", "Western Asia", "Asia"),
    ("Southeast Asia", "South-eastern Asia", "Asia"),  # region written directly, no country
    ("Remote - Europe", None, "Europe"),
    ("Earth", None, None),
])
def test_region_from_location_or_country(location, region, continent):
    assert extract_region(location, extract_country(location)) == (region, continent)


def test_region_search_accepts_regions_continents_and_groups():
    de = ("Western Europe", "Europe", "Germany")
    assert matches_region("Western Europe", *de) and matches_region("europe", *de) and matches_region("DACH", *de)
    assert matches_region("European Union", *de) and not matches_region("Asia", *de)
    assert matches_region("Middle East", "Western Asia", "Asia", "United Arab Emirates")
    assert matches_region("Middle East", "Northern Africa", "Africa", "Egypt")
    assert matches_region("Southeast Asia", "South-eastern Asia", "Asia", "Singapore")
    assert matches_region("Latin America", "Central America", "North America", "Mexico")
    assert matches_region("Nordics", "Northern Europe", "Europe", "Sweden")
    assert not matches_region("Nordics", "Northern Europe", "Europe", "United Kingdom")
    assert not matches_region("Europe", None, None, None)
