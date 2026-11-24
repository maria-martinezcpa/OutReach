from app.contacts import extract_contacts, extract_country, extract_emails, extract_phones, extract_roles


def test_public_email_website_and_social_accounts():
    user = {"email": "ada@lovelace.dev", "blog": "ada.dev", "twitter_username": "ada", "bio": None}
    social = [{"provider": "linkedin", "url": "https://www.linkedin.com/in/ada-lovelace"},
              {"provider": "mastodon", "url": "https://hachyderm.io/@ada"}]
    c = extract_contacts(user, social, None)
    assert [e.value for e in c.emails] == ["ada@lovelace.dev"]
    assert c.emails[0].source == "GitHub public email"
    assert c.linkedin.value == "https://www.linkedin.com/in/ada-lovelace"
    assert c.website == "https://ada.dev"
    labels = {l.label for l in c.links}
    assert {"Website", "Mastodon", "Twitter/X"} <= labels


def test_readme_links_emails_and_badges():
    readme = """
    [![LinkedIn](https://img.shields.io/badge/LinkedIn-blue)](https://linkedin.com/in/jdoe/)
    Reach me: [mail](mailto:jdoe@proton.me) or https://medium.com/@jdoe
    ![stats](https://github-readme-stats.vercel.app/api?username=jdoe)
    """
    c = extract_contacts({"login": "jdoe"}, [], readme)
    assert c.linkedin and "linkedin.com/in/jdoe" in c.linkedin.value
    assert c.linkedin.source == "Profile README"
    assert [e.value for e in c.emails] == ["jdoe@proton.me"]
    assert [l.label for l in c.links] == ["Medium"]


def test_linkedin_not_duplicated_between_sources():
    user = {"blog": "https://linkedin.com/in/sam"}
    c = extract_contacts(user, [{"provider": "linkedin", "url": "https://www.linkedin.com/in/sam/"}], None)
    assert c.linkedin.value == "https://linkedin.com/in/sam"
    assert c.links == []


def test_email_filters_noreply_and_images():
    text = "123+x@users.noreply.github.com logo@2x.png real.person@company.io"
    assert extract_emails(text) == ["real.person@company.io"]


def test_phone_requires_label_or_international_format():
    assert extract_phones("Phone: 555 123 4567") == ["555 123 4567"]
    assert extract_phones("call me +44 20 7946 0958 anytime") == ["+44 20 7946 0958"]
    assert extract_phones("https://wa.me/4915112345678") == ["+4915112345678"]
    # Years, versions and plain numbers are not phone numbers.
    assert extract_phones("Worked 2019-2023, version 1.2.3, 12345678 downloads") == []


def test_roles():
    roles = extract_roles("Senior GIS Developer @ Esri | PhD student", None)
    assert [r.title for r in roles] == ["Senior GIS Developer", "PhD Student"]
    assert extract_roles("Software engineers are cool", None)[0].title == "Software Engineer"
    # Generic roles are dropped when a specific one exists.
    assert [r.title for r in extract_roles("Developer and BIM Manager", None)] == ["BIM Manager"]


def test_country():
    assert extract_country("Berlin, Germany") == "Germany"
    assert extract_country("Austin, TX") == "United States"
    assert extract_country("London") == "United Kingdom"
    assert extract_country("Bengaluru") == "India"
    assert extract_country("Remote / Earth") is None
    assert extract_country("Seoul, Korea") == "South Korea"
    assert extract_country(None) is None


def test_telegram_from_social_accounts_bio_and_readme():
    # GitHub stores a t.me social account as the "generic" provider.
    c = extract_contacts({}, [{"provider": "generic", "url": "https://t.me/ada_dev"}], None)
    assert c.telegram.value == "https://t.me/ada_dev"
    assert c.telegram.source == "GitHub linked social accounts"
    assert c.links == []

    c = extract_contacts({"bio": "GIS dev · telegram.me/Jdoe_99"}, [], None)
    assert c.telegram.value == "https://t.me/Jdoe_99" and c.telegram.source == "GitHub bio"

    c = extract_contacts({}, [], "Contact me on Telegram: @sam_writes or by mail")
    assert c.telegram.value == "https://t.me/sam_writes" and c.telegram.source == "Profile README"

    c = extract_contacts({"blog": "https://t.me/sam_writes"}, [], "[tg](https://t.me/sam_writes/)")
    assert c.telegram.value == "https://t.me/sam_writes" and c.links == []


def test_telegram_ignores_invite_links_and_unrelated_handles():
    text = "Join https://t.me/joinchat/AbCdEf and follow me @someone_cool on x.com; post t.me/chan_name/123"
    c = extract_contacts({}, [], text)
    assert c.telegram is None


def test_telegram_moved_out_of_links_for_old_stored_profiles():
    from app.models import Contacts
    c = Contacts.model_validate({"links": [{"label": "Telegram", "url": "https://t.me/dana_s", "source": "GitHub bio"}]})
    assert c.telegram.value == "https://t.me/dana_s" and c.links == []
