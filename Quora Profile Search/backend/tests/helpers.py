from app.services.ai import ExtractedPerson

DEFAULTS = dict(index=0, is_individual_person=True, full_name=None, job_title=None, company=None, industry=None,
                experience=None, years_experience=None, skills=[], programming_languages=[], interests=[],
                freelance_available=None, location=None, city=None, state=None, country="UNKNOWN",
                location_evidence=None)


def ep(**kw) -> ExtractedPerson:
    return ExtractedPerson(**{**DEFAULTS, **kw})
