"""The profile cache is kept in memory and written to disk in the background, not once per profile."""

import json
from datetime import datetime, timezone

from app import storage
from app.models import Analysis, Contacts, Profile
from app.storage import Store


def profile(login: str, uid: int, **kw) -> Profile:
    return Profile(id=uid, login=login, github_url=f"https://github.com/{login}", contacts=Contacts(),
                   analysis=Analysis(human_confidence="HIGH", activity_status="ACTIVE", method="test"),
                   fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"), **kw)


def on_disk(tmp_path) -> dict:
    path = tmp_path / "profiles_cache.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def test_cache_is_written_in_batches_not_per_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CACHE_FLUSH_SECONDS", 3600)
    st = Store(tmp_path)
    for i in range(20):
        st.put_cached(profile(f"user{i}", i))
    assert on_disk(tmp_path) == {}  # nothing written yet...
    assert st.get_cached("USER7").login == "user7"  # ...but everything is available, case-insensitively
    st.flush_cache()
    assert len(on_disk(tmp_path)) == 20
    assert Store(tmp_path).get_cached("user19").id == 19  # survives a restart


def test_background_flush_after_the_interval(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CACHE_FLUSH_SECONDS", 0)
    st = Store(tmp_path)
    st.put_cached(profile("alice", 1))
    st._flush_thread.join(5)
    assert list(on_disk(tmp_path)) == ["1"]


def test_deleting_data_is_written_immediately(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CACHE_FLUSH_SECONDS", 3600)
    st = Store(tmp_path)
    st.put_cached(profile("alice", 1))
    st.put_cached(profile("bob", 2))
    st.flush_cache()
    assert st.delete_cached("Alice") is True
    assert list(on_disk(tmp_path)) == ["2"]
    assert st.get_cached("alice") is None


def test_renamed_account_is_found_under_its_new_name_only(tmp_path):
    st = Store(tmp_path)
    st.put_cached(profile("oldname", 5))
    st.put_cached(profile("newname", 5))
    assert st.get_cached("oldname") is None
    assert st.get_cached("newname").id == 5
    assert [e["login"] for e in st.cached_entries()] == ["newname"]


def test_reads_existing_indented_cache_files(tmp_path):
    (tmp_path / "profiles_cache.json").write_text(
        json.dumps({"9": profile("carol", 9, location="Oslo").model_dump(mode="json")}, indent=2), encoding="utf-8")
    st = Store(tmp_path)
    assert st.get_cached("carol").location == "Oslo"
    assert [e["location"] for e in st.cached_entries()] == ["Oslo"]
