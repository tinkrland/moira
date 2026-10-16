"""work yaml loading, validation and canonical dump.

a work file is validated against:
- the vocab (every tag value exists on its axis; single/multi role rules)
- evidence (every layer 2 tag carries a one-line evidence string)
- scope (anglosphere origin, english language, first release >= 2000)

the dump() function is canonical: yaml -> sqlite -> dump() is byte-identical
for files authored with dump().
"""

import datetime
import re

import yaml

from .vocab import kebab, catalog_error, check_trait_ref

mediums = ("book", "tv", "movie")
units = ("series", "standalone", "season_override", "volume_override")
statuses = ("draft", "reviewed")
anglosphere = ("us", "uk", "gb", "ca", "au", "nz", "ie")
external_id_keys = ("wikidata", "tmdb", "openlibrary", "isbn")
crime_genres = ("crime", "noir", "cozy-mystery", "legal", "thriller")
link_kinds = ("adaptation_of", "sequel_of", "same_universe", "remake_of")
strengths = ("loved", "liked")

# canonical field order for dump(). layer 2 order follows schema.md.
work_fields = (
    "id", "title", "medium", "unit", "first_release", "origin", "language",
    "creators", "external_ids", "status", "tag_version", "tagged_by", "date",
)
layer1_fields = (
    "genre_tradition", "setting_geo", "setting_era", "lead_performers",
)
# every work gets these layer 2 axes (schema.md). motifs is proposal-only.
core_axes = (
    "tone", "authority_stance", "protagonist_gift", "ensemble_shape", "fantasy",
    "structure", "resolution", "stakes", "world", "tech_mediation",
    "lead_gender", "lead_manner", "lead_flaw_treatment",
)
axis_order = core_axes + ("motifs",)
crime_fields = ("crime_relation", "mystery_mechanism", "lens", "detecting_subject", "legal_role")


def load_yaml(path):
    with open(path) as f:
        doc = yaml.safe_load(f)
    if not isinstance(doc, dict):
        raise catalog_error([f"{path}: file is not a mapping"])
    return doc


def _plain(value):
    """yaml date objects become iso strings so dump output stays stable."""
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    return value


def validate_work(doc, vocab, filename="work"):
    """validate one work mapping. returns errors, never raises for content."""
    errors = []
    e = errors.append

    for field in work_fields:
        if field not in doc:
            e(f"{filename}: missing required field: {field}")

    wid = doc.get("id")
    if not wid or not isinstance(wid, str) or not kebab.fullmatch(wid):
        e(f"{filename}: id must be a kebab-case slug")
        wid = wid if isinstance(wid, str) else None
    elif filename != "work" and str(filename).rsplit("/", 1)[-1].rsplit(".", 1)[0] != wid:
        e(f"{filename}: filename must match work id (expected {wid}.yaml)")

    if doc.get("medium") not in mediums:
        e(f"{filename}: medium must be one of {mediums}")
    if doc.get("unit") not in units:
        e(f"{filename}: unit must be one of {units}")
    if doc.get("status") not in statuses:
        e(f"{filename}: status must be draft or reviewed")

    release = doc.get("first_release")
    if not isinstance(release, int) or isinstance(release, bool):
        e(f"{filename}: first_release must be an integer year")
    elif release < 2000:
        e(f"{filename}: first_release {release} is before 2000 (out of v0 scope)")

    origin = doc.get("origin")
    if not isinstance(origin, list) or not origin:
        e(f"{filename}: origin must be a non-empty list of country codes")
    elif not any(c in anglosphere for c in origin):
        e(f"{filename}: no anglosphere origin country in {origin}")

    if doc.get("language") != "english":
        e(f"{filename}: language must be english for v0")

    tag_version = doc.get("tag_version")
    if not isinstance(tag_version, int) or isinstance(tag_version, bool) or tag_version < 1:
        e(f"{filename}: tag_version must be an integer >= 1")

    creators = doc.get("creators")
    if creators is not None and not isinstance(creators, list):
        e(f"{filename}: creators must be a list or null")

    ext = doc.get("external_ids")
    if ext is not None:
        if not isinstance(ext, dict):
            e(f"{filename}: external_ids must be a mapping or null")
        else:
            for key, value in ext.items():
                if key not in external_id_keys:
                    e(f"{filename}: external_ids key not allowed: {key}")
                elif not isinstance(value, str) or not value:
                    e(f"{filename}: external_ids.{key} must be a non-empty string or absent")

    # layer 1
    genre = doc.get("genre_tradition")
    if not isinstance(genre, list) or not genre:
        e(f"{filename}: genre_tradition must be a non-empty list")
    else:
        for g in genre:
            if not isinstance(g, str):
                e(f"{filename}: genre_tradition entries must be strings")
            else:
                err = check_trait_ref(vocab, "genre_tradition", g)
                if err:
                    e(f"{filename}: {err}")

    for opt in ("setting_geo", "setting_era", "lead_performers"):
        if opt in doc and doc[opt] is not None and not isinstance(doc[opt], (str, list)):
            e(f"{filename}: {opt} must be a string, a list or null")

    # crime module: only active for crime-family genres
    crime = doc.get("crime_module")
    if crime is not None:
        if not isinstance(crime, dict) or not crime:
            e(f"{filename}: crime_module must be a non-empty mapping or null")
            crime = None
    if crime is not None:
        has_crime_genre = isinstance(genre, list) and any(g in crime_genres for g in genre if isinstance(g, str))
        if not has_crime_genre:
            e(f"{filename}: crime_module present but genre_tradition has no crime-family genre")
        relation = crime.get("crime_relation")
        if not relation:
            e(f"{filename}: crime_module requires crime_relation")
        else:
            err = check_trait_ref(vocab, "crime_relation", relation)
            if err:
                e(f"{filename}: {err}")
        for field in ("mystery_mechanism", "lens", "detecting_subject", "legal_role"):
            if field not in crime:
                continue
            values = crime[field]
            if not isinstance(values, list):
                e(f"{filename}: crime_module.{field} must be a list")
                continue
            for v in values:
                err = check_trait_ref(vocab, field, v)
                if err:
                    e(f"{filename}: {err}")
        if "legal_role" in crime and crime.get("crime_relation") not in ("defending", "combination"):
            e(f"{filename}: legal_role requires crime_relation defending or combination")

    # layer 2 tags
    tags = doc.get("tags")
    if not isinstance(tags, dict):
        e(f"{filename}: tags must be a mapping of axis -> tag list")
        tags = None
    if tags is not None:
        for axis in tags:
            if axis not in vocab:
                e(f"{filename}: unknown tag axis: {axis}")
        for axis in core_axes:
            if axis not in tags:
                e(f"{filename}: missing core layer 2 axis: {axis}")
        for axis, entries in tags.items():
            if axis not in vocab:
                continue
            if not isinstance(entries, list) or not entries:
                e(f"{filename}: {axis} must be a non-empty tag list")
                continue
            seen = set()
            primaries = 0
            secondaries = 0
            for entry in entries:
                if not isinstance(entry, dict):
                    e(f"{filename}: {axis} entries must be mappings")
                    continue
                value = entry.get("value")
                role = entry.get("role")
                evidence = entry.get("evidence")
                if not isinstance(value, str):
                    e(f"{filename}: {axis} tag value must be a string")
                    continue
                err = check_trait_ref(vocab, axis, value)
                if err:
                    e(f"{filename}: {err}")
                if value in seen:
                    e(f"{filename}: duplicate tag value on {axis}: {value}")
                seen.add(value)
                if role not in ("primary", "secondary"):
                    e(f"{filename}: {axis}/{value}: role must be primary or secondary")
                elif role == "primary":
                    primaries += 1
                else:
                    secondaries += 1
                if not isinstance(evidence, str) or not evidence.strip():
                    e(f"{filename}: {axis}/{value}: missing evidence line")
                # prime directive 11: no evidence line, no tag.
            select = vocab[axis]["select"]
            if select == "single":
                if primaries != 1 or secondaries != 0 or len(entries) != 1:
                    e(f"{filename}: {axis} is single-select: exactly one primary entry, no secondaries")
            else:
                if primaries > 2:
                    e(f"{filename}: {axis} has more than 2 primary tags")
                if secondaries > 3:
                    e(f"{filename}: {axis} has more than 3 secondary tags")

    # links (work -> other works). open question 21 covers this syntax.
    links = doc.get("links")
    if links is not None:
        if not isinstance(links, list):
            e(f"{filename}: links must be a list or null")
        else:
            for link in links:
                if not isinstance(link, dict):
                    e(f"{filename}: link entries must be mappings")
                    continue
                if link.get("kind") not in link_kinds:
                    e(f"{filename}: link kind must be one of {link_kinds}")
                if not isinstance(link.get("work"), str) or not link.get("work"):
                    e(f"{filename}: link requires a work reference")

    known_keys = set(work_fields) | set(layer1_fields) | {"crime_module", "tags", "links"}
    for key in doc:
        if key not in known_keys:
            e(f"{filename}: unknown field: {key}")

    return errors


def normalize(doc):
    """return a copy of a validated work with dates plain and fields ordered."""
    out = {}
    for field in work_fields:
        out[field] = _plain(doc.get(field))
    for field in layer1_fields:
        if doc.get(field) is not None:
            out[field] = _plain(doc[field])
    if doc.get("crime_module"):
        out["crime_module"] = {k: _plain(v) for k, v in doc["crime_module"].items()}
    if doc.get("tags"):
        out["tags"] = {
            axis: [
                {"value": t["value"], "role": t["role"], "evidence": _plain(t["evidence"])}
                for t in entries
            ]
            for axis, entries in doc["tags"].items()
        }
    if doc.get("links"):
        out["links"] = [{"work": l["work"], "kind": l["kind"]} for l in doc["links"]]
    return out


def dump(doc):
    """canonical yaml for one work. round-trips through sqlite byte-identically."""
    return yaml.safe_dump(normalize(doc), sort_keys=False, default_flow_style=False, width=1000)
