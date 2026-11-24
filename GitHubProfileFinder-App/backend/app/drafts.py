"""Personal email drafts: subject/body templates, a signature and the app that opens each draft.

Nothing is sent from here. A draft is opened in the user's own email app (or Telegram), filled in for one
person, and the user reviews and sends it themselves. Settings live in data/drafts.json.
"""

import os
import re
import sys
import webbrowser
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .storage import JsonFile

DraftApp = Literal["my_email", "mailto", "gmail", "outlook", "outlook_work", "yahoo", "telegram", "custom"]
SenderProvider = Literal["auto", "gmail", "outlook", "outlook_work", "other"]
# An email address typed where a link was expected, e.g. "https://me@outlook.com".
EMAIL_AS_LINK = re.compile(r"^(?:https?://|mailto:)?([^/@\s]+@[^/@\s]+\.[^/@\s]+?)/?$")
OPENABLE_SCHEMES = ("mailto:", "https://", "tg://")

DEFAULT_SUBJECT = "Your work on {repo}"
DEFAULT_BODY = """Hi {first_name},

I came across your GitHub profile and your work on {repo} ({skill}).

...

Best regards,
"""


class Template(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,20}$")
    name: str = Field(min_length=1, max_length=60)
    subject: str = Field("", max_length=300)
    body: str = Field("", max_length=10000)


class DraftSettings(BaseModel):
    app: DraftApp = "mailto"
    # Custom compose URL for any other service; {to}, {subject} and {body} are replaced (URL-encoded).
    custom_url: str = Field("", max_length=500)
    # Added below the message of every template; placeholders work here too.
    signature: str = Field("", max_length=2000)
    # "my_email": drafts open in the mailbox of this address; its provider is detected from the domain
    # (gmail.com -> Gmail, outlook.com/hotmail/live -> Outlook.com) unless sender_provider says otherwise.
    sender_email: str = Field("", max_length=254)
    sender_provider: SenderProvider = "auto"
    # Where each web mailbox lives; change these to open a specific account (e.g. .../mail/u/1/ in Gmail).
    gmail_link: str = "https://mail.google.com/mail/"
    outlook_link: str = "https://outlook.live.com/mail/0/"
    outlook_work_link: str = "https://outlook.office.com/mail/"
    templates: list[Template] = Field(
        default_factory=lambda: [Template(id="default", name="Default", subject=DEFAULT_SUBJECT, body=DEFAULT_BODY)],
        min_length=1, max_length=20)
    default_template: str = "default"

    @model_validator(mode="before")
    @classmethod
    def upgrade_single_template(cls, data):
        """Settings saved before templates existed had one subject/body: keep it as the "Default" template."""
        if isinstance(data, dict) and "templates" not in data and ("subject" in data or "body" in data):
            data = {**data, "templates": [{"id": "default", "name": "Default",
                                           "subject": data.get("subject", DEFAULT_SUBJECT),
                                           "body": data.get("body", DEFAULT_BODY)}]}
        # A custom "link" that is really an email address means "open drafts in this mailbox".
        if isinstance(data, dict) and data.get("app") == "custom" and (m := EMAIL_AS_LINK.match(data.get("custom_url", "").strip())):
            data = {**data, "app": "my_email", "sender_email": m.group(1), "custom_url": ""}
        return data

    @field_validator("sender_email")
    @classmethod
    def check_sender(cls, v: str) -> str:
        v = v.strip()
        if v and not re.fullmatch(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", v):
            raise ValueError("Your email address does not look valid")
        return v

    @field_validator("gmail_link", "outlook_link", "outlook_work_link")
    @classmethod
    def check_mailbox_link(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("https://") or "?" in v or "#" in v:
            raise ValueError("Mailbox links must start with https:// and have no ? or #")
        return v if v.endswith("/") else v + "/"

    @field_validator("custom_url")
    @classmethod
    def check_custom_url(cls, v: str) -> str:
        v = v.strip()
        if v and not v.startswith(OPENABLE_SCHEMES):
            raise ValueError("The custom URL must start with https://, mailto: or tg://")
        return v

    @model_validator(mode="after")
    def check_templates(self):
        if self.app == "my_email" and not self.sender_email:
            raise ValueError("Enter your email address to open drafts in its mailbox")
        ids = [t.id for t in self.templates]
        if len(set(ids)) != len(ids):
            raise ValueError("Template ids must be unique")
        if self.default_template not in ids:
            self.default_template = ids[0]
        return self


class DraftStore:
    def __init__(self, data_dir: Path):
        self.file = JsonFile(Path(data_dir) / "drafts.json", {})

    def get(self) -> DraftSettings:
        return DraftSettings.model_validate(self.file.read())

    def put(self, settings: DraftSettings) -> DraftSettings:
        self.file.write(settings.model_dump(mode="json"))
        return settings


class OpenRequest(BaseModel):
    url: str = Field(max_length=20000)

    @field_validator("url")
    @classmethod
    def check_scheme(cls, v: str) -> str:
        if not v.startswith(OPENABLE_SCHEMES):
            raise ValueError("Only mailto:, https:// and tg:// links can be opened")
        return v


def open_url(url: str) -> None:
    """Hand a link to the operating system: the default mail app, browser or Telegram opens it."""
    if sys.platform == "win32":
        os.startfile(url)  # noqa: S606 - scheme checked by OpenRequest
    else:
        webbrowser.open(url)
