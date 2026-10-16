"""shared fixtures: real vocab plus the draft fixture works."""

import sys
from pathlib import Path

import pytest

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))

from src.build.vocab import load_vocab  # noqa: e402

vocab_dir = root / "data" / "vocab"
works_dir = root / "tests" / "fixtures" / "works"


@pytest.fixture(scope="session")
def vocab():
    return load_vocab(vocab_dir)


@pytest.fixture(scope="session")
def work_ids():
    return {p.stem for p in works_dir.glob("*.yaml")}


@pytest.fixture
def valid_work():
    """a deep copy of the psych fixture, loaded from disk."""
    import yaml

    with open(works_dir / "psych-2006.yaml") as f:
        return yaml.safe_load(f)
