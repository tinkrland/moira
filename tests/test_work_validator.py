"""work validator: scope, vocab, evidence and role rules (buildplan phase 0)."""

import copy

import pytest

from src.build.works import validate_work

from conftest import works_dir


def validate(doc, vocab, filename="psych-2006.yaml"):
    return validate_work(doc, vocab, filename=filename)


def test_fixture_works_are_valid(vocab):
    import yaml

    for path in sorted(works_dir.glob("*.yaml")):
        with open(path) as f:
            doc = yaml.safe_load(f)
        assert validate(doc, vocab, filename=str(path)) == [], path.name


def test_out_of_scope_year_rejected(vocab, valid_work):
    valid_work["first_release"] = 1999
    assert any("before 2000" in m for m in validate(valid_work, vocab))


def test_non_anglosphere_origin_rejected(vocab, valid_work):
    valid_work["origin"] = ["fr"]
    assert any("anglosphere" in m for m in validate(valid_work, vocab))


def test_non_english_rejected(vocab, valid_work):
    valid_work["language"] = "french"
    assert any("english" in m for m in validate(valid_work, vocab))


def test_unknown_vocab_value_rejected(vocab, valid_work):
    valid_work["tags"]["tone"][0]["value"] = "spooky"
    assert any("unknown value for tone" in m for m in validate(valid_work, vocab))


def test_missing_evidence_rejected(vocab, valid_work):
    del valid_work["tags"]["tone"][0]["evidence"]
    assert any("missing evidence" in m for m in validate(valid_work, vocab))


def test_blank_evidence_rejected(vocab, valid_work):
    valid_work["tags"]["tone"][0]["evidence"] = "   "
    assert any("missing evidence" in m for m in validate(valid_work, vocab))


def test_single_select_allows_one_primary_only(vocab, valid_work):
    valid_work["tags"]["structure"].append(
        {"value": "serialized", "role": "secondary", "evidence": "second entry"}
    )
    assert any("single-select" in m for m in validate(valid_work, vocab))


def test_single_select_rejects_two_entries(vocab, valid_work):
    valid_work["tags"]["structure"] = [
        {"value": "episodic-closed", "role": "primary", "evidence": "a"},
        {"value": "serialized", "role": "primary", "evidence": "b"},
    ]
    assert any("single-select" in m for m in validate(valid_work, vocab))


def test_multi_select_caps_primaries(vocab, valid_work):
    valid_work["tags"]["fantasy"] = [
        {"value": v, "role": "primary", "evidence": "e"}
        for v in ("competence", "justice", "puzzle")
    ]
    assert any("more than 2 primary" in m for m in validate(valid_work, vocab))


def test_multi_select_caps_secondaries(vocab, valid_work):
    valid_work["tags"]["lead_manner"] = [
        {"value": v, "role": "secondary", "evidence": "e"}
        for v in ("abrasive", "deadpan", "overzealous", "reserved")
    ]
    assert any("more than 3 secondary" in m for m in validate(valid_work, vocab))


def test_unknown_value_is_legal_anywhere(vocab, valid_work):
    # prime directive 2: unknown is always allowed
    valid_work["tags"]["structure"] = [
        {"value": "unknown", "role": "primary", "evidence": "not yet reviewed"}
    ]
    assert validate(valid_work, vocab) == []


def test_missing_core_axis_rejected(vocab, valid_work):
    del valid_work["tags"]["fantasy"]
    assert any("missing core layer 2 axis: fantasy" in m for m in validate(valid_work, vocab))


def test_crime_module_needs_crime_genre(vocab, valid_work):
    valid_work["genre_tradition"] = ["drama"]
    assert any("crime_module" in m for m in validate(valid_work, vocab))


def test_legal_role_needs_defending(vocab, valid_work):
    valid_work["crime_module"]["legal_role"] = ["prosecution"]
    assert any("legal_role requires" in m for m in validate(valid_work, vocab))


def test_crime_module_vocab_checked(vocab, valid_work):
    valid_work["crime_module"]["mystery_mechanism"] = ["whatsit"]
    assert any("unknown value for mystery_mechanism" in m for m in validate(valid_work, vocab))


def test_bad_role_rejected(vocab, valid_work):
    valid_work["tags"]["tone"][0]["role"] = "tertiary"
    assert any("role must be" in m for m in validate(valid_work, vocab))


def test_duplicate_tag_value_rejected(vocab, valid_work):
    valid_work["tags"]["fantasy"] = [
        {"value": "belonging", "role": "primary", "evidence": "a"},
        {"value": "belonging", "role": "secondary", "evidence": "b"},
    ]
    assert any("duplicate tag value" in m for m in validate(valid_work, vocab))


def test_external_id_keys_limited(vocab, valid_work):
    valid_work["external_ids"] = {"imdb": "tt0471732"}
    assert any("external_ids key not allowed" in m for m in validate(valid_work, vocab))


def test_filename_must_match_id(vocab, valid_work):
    assert any("filename must match work id" in m for m in validate(valid_work, vocab, filename="wrong-name.yaml"))


def test_unknown_field_rejected(vocab, valid_work):
    valid_work["vibe"] = "great"
    assert any("unknown field: vibe" in m for m in validate(valid_work, vocab))
