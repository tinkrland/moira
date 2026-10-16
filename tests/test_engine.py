"""scenario tests s1 to s5 for the phase 3 core loop (recommend + tags)."""

import copy
import hashlib

import pytest
import yaml

from src.build.compiler import compile_db, load_works
from src.build.vocab import load_vocab
from src.build.works import dump as dump_work, validate_work
from src.query.engine import engine

from conftest import root as ROOT, vocab_dir as VOCAB_DIR, works_dir as WORKS_DIR

CONFIG = ROOT / "config" / "scoring.v0.yaml"


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    vocab = load_vocab(VOCAB_DIR)
    works = load_works(WORKS_DIR, vocab)
    path = tmp_path_factory.mktemp("eng") / "latent.db"
    compile_db(works, vocab, path)
    return path


@pytest.fixture(scope="module")
def eng(db):
    return engine(db, CONFIG)


def write_context(tmp_path, doc):
    path = tmp_path / "context.yaml"
    path.write_text(yaml.safe_dump(doc, sort_keys=False, default_flow_style=False))
    return path


def run_recommend(eng, tmp_path, doc):
    return eng.recommend(write_context(tmp_path, doc))


# ---------- s1: incidental mechanism on a liked show ----------

def test_s1_work_scoped_incidental_withholds_the_trait(eng, tmp_path):
    result = run_recommend(eng, tmp_path, {
        "taste_context_version": 1,
        "liked": [
            {"work": "monk-2002", "strength": "loved"},
            {"work": "elsbeth-2024", "strength": "liked"},
        ],
        "incidental": [
            {"work": "elsbeth-2024", "trait": {"axis": "mystery_mechanism", "value": "howdunnit"}},
        ],
    })
    ignored = result["ignored_as_incidental"]
    assert {"work": "elsbeth-2024", "trait": "mystery_mechanism/howdunnit"} in ignored
    # howdunnit does not contribute to the profile
    profile_traits = [p["trait"] for p in result["profile"]]
    assert "mystery_mechanism/howdunnit" not in profile_traits
    # elsbeth stays liked: its other tags contribute (adjacent-consultant only elsbeth carries)
    assert "authority_stance/adjacent-consultant" in profile_traits


def test_s1_without_the_mark_the_trait_counts(eng, tmp_path):
    result = run_recommend(eng, tmp_path, {
        "taste_context_version": 1,
        "liked": [{"work": "elsbeth-2024", "strength": "liked"}],
    })
    assert "mystery_mechanism/howdunnit" in [p["trait"] for p in result["profile"]]


# ---------- s2: nostalgia (work-scoped vs the same trait elsewhere) ----------

def make_work(work_id, title, tags, **extra):
    doc = {
        "id": work_id, "title": title, "medium": "tv", "unit": "series",
        "first_release": 2005, "origin": ["us"], "language": "english",
        "creators": None, "external_ids": None, "status": "reviewed",
        "tag_version": 1, "tagged_by": "model", "date": "2026-10-16",
        "genre_tradition": ["drama"],
        "tags": tags,
    }
    doc.update(extra)
    return doc


def core_tags(**overrides):
    def t(axis, value, role="primary", evidence="illustrative"):
        return {"value": value, "role": role, "evidence": evidence}
    tags = {
        "tone": [t("tone", "earnest")],
        "authority_stance": [t("authority_stance", "unknown")],
        "protagonist_gift": [t("protagonist_gift", "charm")],
        "ensemble_shape": [t("ensemble_shape", "literal-family")],
        "fantasy": [t("fantasy", "belonging")],
        "structure": [t("structure", "episodic-closed")],
        "resolution": [t("resolution", "mostly-closed")],
        "stakes": [t("stakes", "low")],
        "world": [t("world", "realist")],
        "tech_mediation": [t("tech_mediation", "low")],
        "lead_gender": [t("lead_gender", "female")],
        "lead_manner": [t("lead_manner", "charming")],
        "lead_flaw_treatment": [t("lead_flaw_treatment", "no-flaw-focus")],
        "romantic_arc": [t("romantic_arc", "none")],
    }
    for axis, entries in overrides.items():
        tags[axis] = entries
    return tags


@pytest.fixture(scope="module")
def cozy_db(tmp_path_factory):
    vocab = load_vocab(VOCAB_DIR)
    works = {
        "nostalgia-show": make_work("nostalgia-show", "nostalgia show", core_tags(
            tone=[{"value": "cozy", "role": "primary", "evidence": "warm rituals with a parent figure"}],
        )),
        "other-cozy-show": make_work("other-cozy-show", "other cozy show", core_tags(
            tone=[{"value": "cozy", "role": "primary", "evidence": "tearoom mysteries"}],
        )),
    }
    for w in works.values():
        assert validate_work(w, vocab) == []
    path = tmp_path_factory.mktemp("cozy") / "latent.db"
    compile_db(works, vocab, path)
    return path


def test_s2_incidental_scoped_to_one_show_keeps_the_trait_elsewhere(cozy_db, tmp_path):
    eng = engine(cozy_db, CONFIG)
    result = eng.recommend(write_context(tmp_path, {
        "taste_context_version": 1,
        "liked": [
            {"work": "nostalgia-show", "strength": "loved"},
            {"work": "other-cozy-show", "strength": "liked"},
        ],
        "incidental": [
            {"work": "nostalgia-show", "trait": {"axis": "tone", "value": "cozy"}},
        ],
    }))
    ignored = [i["trait"] for i in result["ignored_as_incidental"]]
    assert "tone/cozy" in ignored
    assert {"work": "nostalgia-show", "trait": "tone/cozy"} in result["ignored_as_incidental"]
    # cozy still counts from the other show: it stays in the profile
    assert "tone/cozy" in [p["trait"] for p in result["profile"]]


def test_s2_global_incidental_removes_the_trait_everywhere(cozy_db, tmp_path):
    eng = engine(cozy_db, CONFIG)
    result = eng.recommend(write_context(tmp_path, {
        "taste_context_version": 1,
        "liked": [{"work": "other-cozy-show", "strength": "loved"}],
        "incidental": [
            {"work": None, "trait": {"axis": "tone", "value": "cozy"}},
        ],
    }))
    assert "tone/cozy" not in [p["trait"] for p in result["profile"]]
    # remaining tags still signal
    assert result["profile"]


# ---------- s3: surface trait vs compound affinity ----------

@pytest.fixture(scope="module")
def abrasive_db(tmp_path_factory):
    vocab = load_vocab(VOCAB_DIR)
    works = {
        "beloved-hero": make_work("beloved-hero", "beloved hero", core_tags(
            lead_gender=[{"value": "female", "role": "primary", "evidence": "female lead"}],
            lead_manner=[{"value": "abrasive", "role": "primary", "evidence": "cutting with everyone"}],
            lead_flaw_treatment=[{"value": "flaw-tolerated", "role": "primary", "evidence": "the story never demands she be fixed"}],
        )),
        "abrasive-male-candidate": make_work("abrasive-male-candidate", "abrasive male", core_tags(
            lead_gender=[{"value": "male", "role": "primary", "evidence": "male lead"}],
            lead_manner=[{"value": "abrasive", "role": "primary", "evidence": "hostile to everyone"}],
            lead_flaw_treatment=[{"value": "flaw-celebrated", "role": "primary", "evidence": "the show rewards him"}],
        )),
        "abrasive-female-corrected": make_work("abrasive-female-corrected", "abrasive female corrected", core_tags(
            lead_gender=[{"value": "female", "role": "primary", "evidence": "female lead"}],
            lead_manner=[{"value": "abrasive", "role": "primary", "evidence": "brusque with everyone"}],
            lead_flaw_treatment=[{"value": "flaw-corrected", "role": "primary", "evidence": "arcs push her to change"}],
        )),
        "abrasive-female-tolerated": make_work("abrasive-female-tolerated", "abrasive female tolerated", core_tags(
            lead_gender=[{"value": "female", "role": "primary", "evidence": "female lead"}],
            lead_manner=[{"value": "abrasive", "role": "primary", "evidence": "sardonic with everyone"}],
            lead_flaw_treatment=[{"value": "flaw-tolerated", "role": "primary", "evidence": "the show sits with her"}],
        )),
    }
    for w in works.values():
        assert validate_work(w, vocab) == []
    path = tmp_path_factory.mktemp("abrasive") / "latent.db"
    compile_db(works, vocab, path)
    return path


def s3_context():
    return {
        "taste_context_version": 1,
        "liked": [{"work": "beloved-hero", "strength": "loved"}],
        "incidental": [
            # the generic abrasive-lead tag is not the signal
            {"work": None, "trait": {"axis": "lead_manner", "value": "abrasive"}},
        ],
        "affinities": [
            {"id": "abrasive-woman-never-fixed",
             "all_of": [
                 {"axis": "lead_manner", "value": "abrasive"},
                 {"axis": "lead_gender", "value": "female"},
                 {"axis": "lead_flaw_treatment", "value": "flaw-tolerated"},
             ]},
        ],
        "avoid": [
            {"all_of": [
                {"axis": "lead_manner", "value": "abrasive"},
                {"axis": "lead_gender", "value": "male"},
            ]},
        ],
    }


def test_s3_avoid_drops_the_abrasive_male(abrasive_db, tmp_path):
    eng = engine(abrasive_db, CONFIG)
    result = eng.recommend(write_context(tmp_path, s3_context()))
    ids = [c["work"] for c in result["candidates"]]
    assert "abrasive-male-candidate" not in ids


def test_s3_corrected_female_does_not_match_the_affinity(abrasive_db, tmp_path):
    eng = engine(abrasive_db, CONFIG)
    result = eng.recommend(write_context(tmp_path, s3_context()))
    corrected = next(c for c in result["candidates"] if c["work"] == "abrasive-female-corrected")
    share_traits = [s["trait"] for s in corrected["shares"]]
    assert "affinity/abrasive-woman-never-fixed" not in share_traits


def test_s3_tolerated_female_scores_on_the_affinity(abrasive_db, tmp_path):
    eng = engine(abrasive_db, CONFIG)
    result = eng.recommend(write_context(tmp_path, s3_context()))
    tolerated = next(c for c in result["candidates"] if c["work"] == "abrasive-female-tolerated")
    share_traits = [s["trait"] for s in tolerated["shares"]]
    assert "affinity/abrasive-woman-never-fixed" in share_traits


def test_s3_generic_tag_withheld_as_incidental(abrasive_db, tmp_path):
    eng = engine(abrasive_db, CONFIG)
    result = eng.recommend(write_context(tmp_path, s3_context()))
    assert {"work": "beloved-hero", "trait": "lead_manner/abrasive"} in result["ignored_as_incidental"]
    assert "lead_manner/abrasive" not in [p["trait"] for p in result["profile"]]


# ---------- s4: provenance is attribution, not similarity ----------

def test_s4_shares_sum_to_exactly_100(eng, tmp_path):
    result = run_recommend(eng, tmp_path, {
        "taste_context_version": 1,
        "liked": [{"work": "monk-2002", "strength": "loved"}],
    })
    assert result["candidates"]
    for c in result["candidates"]:
        if c["shares"]:
            assert round(sum(s["share"] for s in c["shares"]), 6) == 100.0


def test_s4_no_percent_similar_field(eng, tmp_path):
    result = run_recommend(eng, tmp_path, {
        "taste_context_version": 1,
        "liked": [{"work": "monk-2002", "strength": "loved"}],
    })
    text = yaml.safe_dump(result)
    assert "percent" not in text.lower()


def test_s4_priority_gates_ahead_of_score(abrasive_db, tmp_path):
    eng = engine(abrasive_db, CONFIG)
    # priority: must be flaw-tolerated. the corrected candidate may score
    # higher on generic tags; the gate still puts the tolerated candidate first.
    context = s3_context()
    context["priority"] = [
        {"axis": "lead_flaw_treatment", "value": "flaw-tolerated"},
    ]
    result = eng.recommend(write_context(tmp_path, context))
    ids = [c["work"] for c in result["candidates"]]
    assert ids[0] == "abrasive-female-tolerated"
    first = result["candidates"][0]
    assert first["priority"][0]["tier"] == 1
    assert first["priority"][0]["matched"] is True


# ---------- s5: determinism and statelessness ----------

def test_s5_identical_output_on_repeated_runs(eng, tmp_path):
    context = {
        "taste_context_version": 1,
        "liked": [{"work": "monk-2002", "strength": "loved"},
                  {"work": "elsbeth-2024", "strength": "liked"}],
        "incidental": [
            {"work": "elsbeth-2024", "trait": {"axis": "mystery_mechanism", "value": "howdunnit"}},
        ],
    }
    first = eng.recommend(write_context(tmp_path, context))
    second = eng.recommend(write_context(tmp_path, context))
    assert yaml.safe_dump(first) == yaml.safe_dump(second)


def test_s5_no_writes_at_query_time(eng, db, tmp_path):
    before = hashlib.sha256(db.read_bytes()).hexdigest()
    eng.recommend(write_context(tmp_path, {
        "taste_context_version": 1,
        "liked": [{"work": "monk-2002", "strength": "loved"}],
    }))
    after = hashlib.sha256(db.read_bytes()).hexdigest()
    assert before == after


def test_s5_two_contexts_differ(eng, tmp_path):
    a = run_recommend(eng, tmp_path, {"taste_context_version": 1,
                                      "liked": [{"work": "monk-2002", "strength": "loved"}]})
    b = run_recommend(eng, tmp_path, {"taste_context_version": 1,
                                      "liked": [{"work": "house-md-2004", "strength": "loved"}]})
    assert [c["work"] for c in a["candidates"]] != [c["work"] for c in b["candidates"]]


# ---------- tags command ----------

def test_tags_returns_the_decomposition_with_evidence(eng):
    text = eng.tags("elsbeth-2024")
    assert "evidence:" in text
    assert "adjacent-consultant" in text


def test_tags_rejects_draft_works(eng):
    with pytest.raises(Exception):
        eng.tags("psych-2006")
