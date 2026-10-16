"""vocab loading and validation. one yaml file per axis in data/vocab/."""

import re
from pathlib import Path

import yaml

# values and slugs are kebab-case; axis names are snake_case fields.
kebab = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
snake = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*$")


class catalog_error(Exception):
    """validation failure. carries a list of lowercase message strings."""

    def __init__(self, messages):
        self.messages = [str(m) for m in messages]
        super().__init__("; ".join(self.messages))


def load_vocab(vocab_dir):
    """load every axis file in vocab_dir. returns {axis: {"layer", "select", "values"}}."""
    vocab = {}
    errors = []
    for path in sorted(Path(vocab_dir).glob("*.yaml")):
        with open(path) as f:
            doc = yaml.safe_load(f)
        if not isinstance(doc, dict):
            errors.append(f"{path.name}: file is not a mapping")
            continue
        axis = doc.get("axis")
        if not axis or not snake.fullmatch(str(axis)):
            errors.append(f"{path.name}: bad or missing axis name")
            continue
        if axis in vocab:
            errors.append(f"{path.name}: duplicate axis {axis}")
            continue
        layer = doc.get("layer")
        select = doc.get("select")
        values = doc.get("values")
        if layer not in (1, 2):
            errors.append(f"{axis}: layer must be 1 or 2")
            continue
        if select not in ("single", "multi"):
            errors.append(f"{axis}: select must be single or multi")
            continue
        if not isinstance(values, list):
            errors.append(f"{axis}: values must be a list")
            continue
        bad = [v for v in values if not isinstance(v, str) or not kebab.fullmatch(v)]
        if bad:
            errors.append(f"{axis}: values not kebab-case: {bad}")
            continue
        vocab[axis] = {"layer": layer, "select": select, "values": list(values)}
    if errors:
        raise catalog_error(errors)
    return vocab


def check_trait_ref(vocab, axis, value):
    """return an error message if (axis, value) is not a usable reference."""
    if axis not in vocab:
        return f"unknown axis: {axis}"
    if value == "unknown":
        # prime directive 2: unknown is always a legal value for a tag.
        return None
    if value not in vocab[axis]["values"]:
        return f"unknown value for {axis}: {value}"
    return None
