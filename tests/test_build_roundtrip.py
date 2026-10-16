"""build and round trip: yaml -> sqlite -> yaml must be unchanged (phase 0)."""

import sqlite3

import pytest

from src.build.compiler import compile_db, load_works, read_work
from src.build.works import dump, load_yaml

from conftest import vocab_dir, works_dir


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    vocab = pytest.importorskip("src.build.vocab").load_vocab(vocab_dir)
    works = load_works(works_dir, vocab)
    path = tmp_path_factory.mktemp("db") / "latent.db"
    compile_db(works, vocab, path)
    return path


def test_round_trip_byte_identical(db):
    for path in sorted(works_dir.glob("*.yaml")):
        original = path.read_text()
        doc = read_work(db, path.stem)
        assert dump(doc) == original, path.name


def test_two_builds_produce_identical_dumps(tmp_path):
    vocab = __import__("src.build.vocab", fromlist=["load_vocab"]).load_vocab(vocab_dir)
    works = load_works(works_dir, vocab)
    dumps = []
    for i in range(2):
        p = tmp_path / f"latent-{i}.db"
        compile_db(works, vocab, p)
        parts = []
        for wid in sorted(works):
            parts.append(dump(read_work(p, wid)))
        dumps.append("\n".join(parts))
    assert dumps[0] == dumps[1]


def test_database_tables_and_counts(db):
    con = sqlite3.connect(db)
    try:
        tables = {r[0] for r in con.execute("select name from sqlite_master where type = 'table'")}
        assert {"works", "work_links", "trait_values", "work_traits"} <= tables
        n_works = len({p.stem for p in works_dir.glob("*.yaml")})
        assert con.execute("select count(*) from works").fetchone()[0] == n_works
        # trait_values rows come from the vocab files
        assert con.execute("select count(*) from trait_values").fetchone()[0] > 50
        # every layer 2 tag landed as an edge with evidence
        n_works = len({p.stem for p in works_dir.glob("*.yaml")})
        rows = con.execute("select count(*) from work_traits").fetchone()[0]
        from src.build.works import core_axes
        assert rows >= n_works * len(core_axes)  # every work carries every core axis
    finally:
        con.close()


def test_only_expected_works_enter(db):
    con = sqlite3.connect(db)
    try:
        ids = {r[0] for r in con.execute("select id from works")}
        assert ids == {p.stem for p in works_dir.glob("*.yaml")}
    finally:
        con.close()
