"""taste context loading and validation.

the taste context is the only user-specific input. the engine never stores
it. validation is strict: every reference must exist in the catalog or the
vocab, and unknown refs are an error, never silently ignored.
"""

import re

import yaml

from ..build.vocab import kebab, catalog_error, check_trait_ref
from ..build.works import strengths

context_version = 1


def load_context(path):
    with open(path) as f:
        doc = yaml.safe_load(f)
    if not isinstance(doc, dict):
        raise catalog_error([f"{path}: file is not a mapping"])
    return doc


def _trait_ref_errors(ref, vocab, where, errors):
    if not isinstance(ref, dict):
        errors.append(f"{where}: trait reference must be a mapping of axis and value")
        return
    axis = ref.get("axis")
    value = ref.get("value")
    if not isinstance(axis, str) or not isinstance(value, str):
        errors.append(f"{where}: trait reference needs axis and value strings")
        return
    err = check_trait_ref(vocab, axis, value)
    if err:
        errors.append(f"{where}: {err}")


def validate_context(doc, work_ids, vocab, filename="taste context"):
    """validate a taste context mapping against catalog work ids and vocab."""
    errors = []
    e = errors.append

    version = doc.get("taste_context_version")
    if version != context_version:
        e(f"{filename}: taste_context_version must be {context_version}")

    liked = doc.get("liked")
    if liked is None:
        liked = []
    if not isinstance(liked, list):
        e(f"{filename}: liked must be a list")
        liked = []
    seen_liked = set()
    for entry in liked:
        if not isinstance(entry, dict):
            e(f"{filename}: liked entries must be mappings")
            continue
        work = entry.get("work")
        if not isinstance(work, str) or not work:
            e(f"{filename}: liked entry requires a work reference")
            continue
        if work in seen_liked:
            e(f"{filename}: {work} appears twice in liked")
        seen_liked.add(work)
        if work not in work_ids:
            e(f"{filename}: unknown work in liked: {work}")
        strength = entry.get("strength")
        if strength not in strengths:
            e(f"{filename}: {work}: strength must be one of {strengths}")

    incidental = doc.get("incidental")
    if incidental is None:
        incidental = []
    if not isinstance(incidental, list):
        e(f"{filename}: incidental must be a list")
        incidental = []
    for entry in incidental:
        if not isinstance(entry, dict):
            e(f"{filename}: incidental entries must be mappings")
            continue
        if "work" not in entry:
            e(f"{filename}: incidental entry needs an explicit work key (null means global scope)")
            continue
        work = entry["work"]
        if work is not None and not isinstance(work, str):
            e(f"{filename}: incidental work must be a string or null")
            continue
        if isinstance(work, str) and work not in work_ids:
            e(f"{filename}: unknown work in incidental: {work}")
        trait = entry.get("trait")
        _trait_ref_errors(trait, vocab, f"{filename}: incidental ({work})", errors)

    affinities = doc.get("affinities")
    if affinities is None:
        affinities = []
    if not isinstance(affinities, list):
        e(f"{filename}: affinities must be a list")
        affinities = []
    affinity_ids = set()
    for entry in affinities:
        if not isinstance(entry, dict):
            e(f"{filename}: affinity entries must be mappings")
            continue
        affinity_id = entry.get("id")
        if not isinstance(affinity_id, str) or not kebab.fullmatch(affinity_id):
            e(f"{filename}: affinity id must be a kebab-case slug")
            continue
        if affinity_id in affinity_ids:
            e(f"{filename}: duplicate affinity id: {affinity_id}")
        affinity_ids.add(affinity_id)
        all_of = entry.get("all_of")
        if not isinstance(all_of, list) or not all_of:
            e(f"{filename}: {affinity_id}: all_of must be a non-empty list")
            continue
        for ref in all_of:
            _trait_ref_errors(ref, vocab, f"{filename}: {affinity_id}", errors)

    priority = doc.get("priority")
    if priority is None:
        priority = []
    if not isinstance(priority, list):
        e(f"{filename}: priority must be a list")
        priority = []
    seen_priority = set()
    for item in priority:
        if not isinstance(item, dict):
            e(f"{filename}: priority items must be mappings")
            continue
        if "affinity" in item:
            affinity_id = item.get("affinity")
            if affinity_id not in affinity_ids:
                e(f"{filename}: priority references unknown affinity: {affinity_id}")
            if affinity_id in seen_priority:
                e(f"{filename}: duplicate priority item: {affinity_id}")
            seen_priority.add(affinity_id)
        else:
            _trait_ref_errors(item, vocab, f"{filename}: priority", errors)
            ref_key = (item.get("axis"), item.get("value"))
            if ref_key in seen_priority:
                e(f"{filename}: duplicate priority item: {ref_key[0]}/{ref_key[1]}")
            seen_priority.add(ref_key)

    avoid = doc.get("avoid")
    if avoid is None:
        avoid = []
    if not isinstance(avoid, list):
        e(f"{filename}: avoid must be a list")
        avoid = []
    for entry in avoid:
        if not isinstance(entry, dict) or not isinstance(entry.get("all_of"), list) or not entry.get("all_of"):
            e(f"{filename}: avoid entries must be mappings with a non-empty all_of list")
            continue
        for ref in entry["all_of"]:
            _trait_ref_errors(ref, vocab, f"{filename}: avoid", errors)

    return errors
