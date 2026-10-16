"""taste context validator: refs must exist; unknown refs are errors (phase 0)."""

import copy

import pytest

from src.query.context import validate_context

from conftest import works_dir, root


@pytest.fixture
def valid_context():
    import yaml

    with open(root / "tests" / "fixtures" / "context-valid.yaml") as f:
        return yaml.safe_load(f)


def validate(doc, work_ids, vocab):
    return validate_context(doc, work_ids, vocab, filename="context.yaml")


def test_valid_context_passes(valid_context, work_ids, vocab):
    assert validate(valid_context, work_ids, vocab) == []


def test_unknown_work_in_liked_is_an_error(valid_context, work_ids, vocab):
    valid_context["liked"].append({"work": "monk-2002", "strength": "loved"})
    assert any("unknown work in liked" in m for m in validate(valid_context, work_ids, vocab))


def test_unknown_work_in_incidental_is_an_error(valid_context, work_ids, vocab):
    valid_context["incidental"].append({"work": "nope-1999", "trait": {"axis": "tone", "value": "cozy"}})
    assert any("unknown work in incidental" in m for m in validate(valid_context, work_ids, vocab))


def test_unknown_trait_ref_is_an_error(valid_context, work_ids, vocab):
    valid_context["incidental"].append({"work": "psych-2006", "trait": {"axis": "tone", "value": "spooky"}})
    assert any("unknown value for tone" in m for m in validate(valid_context, work_ids, vocab))


def test_unknown_axis_is_an_error(valid_context, work_ids, vocab):
    valid_context["incidental"].append({"work": "psych-2006", "trait": {"axis": "mood", "value": "cozy"}})
    assert any("unknown axis" in m for m in validate(valid_context, work_ids, vocab))


def test_bad_strength_rejected(valid_context, work_ids, vocab):
    valid_context["liked"][0]["strength"] = "adore"
    assert any("strength must be" in m for m in validate(valid_context, work_ids, vocab))


def test_duplicate_liked_work_rejected(valid_context, work_ids, vocab):
    valid_context["liked"].append({"work": "psych-2006", "strength": "liked"})
    assert any("appears twice" in m for m in validate(valid_context, work_ids, vocab))


def test_priority_unknown_affinity_rejected(valid_context, work_ids, vocab):
    valid_context["priority"].append({"affinity": "not-declared"})
    assert any("unknown affinity" in m for m in validate(valid_context, work_ids, vocab))


def test_priority_duplicate_rejected(valid_context, work_ids, vocab):
    valid_context["priority"].append({"axis": "authority_stance", "value": "outsider-underestimated"})
    assert any("duplicate priority" in m for m in validate(valid_context, work_ids, vocab))


def test_avoid_unknown_trait_rejected(valid_context, work_ids, vocab):
    valid_context["avoid"].append({"all_of": [{"axis": "tone", "value": "bogus"}]})
    assert any("unknown value for tone" in m for m in validate(valid_context, work_ids, vocab))


def test_affinity_empty_all_of_rejected(valid_context, work_ids, vocab):
    valid_context["affinities"].append({"id": "empty", "all_of": []})
    assert any("all_of must be a non-empty list" in m for m in validate(valid_context, work_ids, vocab))


def test_affinity_duplicate_id_rejected(valid_context, work_ids, vocab):
    valid_context["affinities"].append({
        "id": "allowed-to-stay-abrasive",
        "all_of": [{"axis": "tone", "value": "cozy"}],
    })
    assert any("duplicate affinity id" in m for m in validate(valid_context, work_ids, vocab))


def test_bad_version_rejected(valid_context, work_ids, vocab):
    valid_context["taste_context_version"] = 2
    assert any("taste_context_version" in m for m in validate(valid_context, work_ids, vocab))


def test_global_incidental_requires_explicit_null(valid_context, work_ids, vocab):
    entry = {"trait": {"axis": "world", "value": "period"}}
    valid_context["incidental"].append(entry)
    assert any("explicit work key" in m for m in validate(valid_context, work_ids, vocab))
