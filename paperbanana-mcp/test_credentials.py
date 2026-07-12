"""Which key PaperBanana draws on, and what shape the model ids take, is the whole of the
dual-key behaviour — so it is tested as a pure function: env dict + parsed auth.json in,
decision out. No filesystem, no network, no PaperBanana import.

Run: .venv\\Scripts\\python -m pytest test_credentials.py -q
"""

import pytest

from server import resolve_credentials

# OpenRouter namespaces every model ("google/x"); Google's own API takes the bare id.
OR_IMAGE, OR_VLM = "google/gemini-3.1-flash-image-preview", "google/gemini-3.5-flash"
G_IMAGE, G_VLM = "gemini-3.1-flash-image-preview", "gemini-3.5-flash"


def test_env_openrouter_wins_over_everything():
    c = resolve_credentials({"OPENROUTER_API_KEY": "sk-or-env"}, {"google": {"key": "g"}})
    assert (c.source, c.key) == ("openrouter", "sk-or-env")
    assert (c.image_model, c.vlm_model) == (OR_IMAGE, OR_VLM)


def test_env_google_when_no_openrouter():
    c = resolve_credentials({"GOOGLE_API_KEY": "g-env"}, {})
    assert (c.source, c.key) == ("google", "g-env")
    # A "google/" prefix is an OpenRouter-ism; Gemini's own API does not know that id.
    assert (c.image_model, c.vlm_model) == (G_IMAGE, G_VLM)


def test_gemini_api_key_is_accepted_as_an_alias():
    assert resolve_credentials({"GEMINI_API_KEY": "g"}, {}).source == "google"
    assert resolve_credentials({"GOOGLE_GENERATIVE_AI_API_KEY": "g"}, {}).source == "google"


def test_auth_store_openrouter_beats_auth_store_google():
    c = resolve_credentials({}, {"openrouter": {"key": "sk-or"}, "google": {"key": "g"}})
    assert (c.source, c.key) == ("openrouter", "sk-or")


def test_auth_store_google_alone():
    c = resolve_credentials({}, {"google": {"key": "g-auth"}})
    assert (c.source, c.key) == ("google", "g-auth")
    assert c.image_model == G_IMAGE


def test_an_empty_auth_entry_is_not_a_key():
    # A provider can exist in auth.json with no usable key; "" must not win over a real one.
    c = resolve_credentials({}, {"openrouter": {"key": ""}, "google": {"key": "g"}})
    assert (c.source, c.key) == ("google", "g")


def test_explicit_model_overrides_still_win():
    c = resolve_credentials({"OPENROUTER_API_KEY": "k", "PAPERINO_FIGURE_IMAGE_MODEL": "x/y"}, {})
    assert c.image_model == "x/y"
    assert c.vlm_model == OR_VLM


def test_no_key_anywhere_names_both_options():
    with pytest.raises(RuntimeError) as e:
        resolve_credentials({}, {})
    message = str(e.value)
    assert "OpenRouter" in message and "Google" in message
