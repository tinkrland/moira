"""the query engine: tags and recommend (buildplan phase 3).

deterministic and stateless: the same catalog and taste context always
produce identical output, and no query ever writes. only reviewed works
enter the query graph.

interpretations the schema leaves open (open question 25):
- normalized_support(t) divides by the maximum support across all
  supported tags, so the strongest tag scores 1.0.
- candidate scores are normalized by the best candidate's raw sum.
- a compound affinity contributes with the mean axis weight of its
  all_of traits, times its normalized support.
"""

import sqlite3

import yaml

from .context import context_version, load_context, validate_context
from ..build.vocab import catalog_error
from ..build.compiler import read_work
from ..build.works import dump as dump_work


def _connect(db_path):
    # read-only. the query path never writes.
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def _work_trait_list(doc):
    """every (axis, value, role) a work carries, layer 2 then layer 1."""
    out = []
    for axis, entries in doc.get("tags", {}).items():
        for entry in entries:
            out.append((axis, entry["value"], entry["role"]))
    for g in doc.get("genre_tradition") or []:
        out.append(("genre_tradition", g, "primary"))
    crime = doc.get("crime_module") or {}
    relation = crime.get("crime_relation")
    if relation:
        out.append(("crime_relation", relation, "primary"))
    for field in ("mystery_mechanism", "lens", "detecting_subject", "legal_role"):
        for v in crime.get(field) or []:
            out.append((field, v, "primary"))
    return out


class engine:
    def __init__(self, db_path, config_path):
        self.db_path = str(db_path)
        with open(config_path) as f:
            self.config = yaml.safe_load(f)
        self.recommend_config = self.config["recommend"]
        self.strengths = self.recommend_config["strength"]
        self.role_weights = self.recommend_config["role_weight"]
        self.axis_weights = self.config["axis_weights"]
        con = _connect(self.db_path)
        try:
            con.row_factory = sqlite3.Row
            self.vocab = {
                (r["axis"], r["value"]): {"layer": r["layer"], "select": r["select_rule"]}
                for r in con.execute("select * from trait_values")
            }
            self.axes = sorted({a for (a, v) in self.vocab})
            self.works = {}
            for r in con.execute("select id, status from works"):
                if r["status"] == "reviewed":
                    self.works[r["id"]] = read_work(db_path, r["id"])
        finally:
            con.close()
        # trait index: (axis, value) -> {work_id: role}. layer 2 tags plus
        # layer 1 (genre_tradition and the crime module) are all eligible for
        # the profile; layer 1 carries no roles, so every value is primary.
        self.traits = {}
        for wid, doc in self.works.items():
            for axis, value, role in _work_trait_list(doc):
                self.traits.setdefault((axis, value), {})[wid] = role

    # ---------------- tags ----------------

    def tags(self, work_id):
        """the decomposed tags with evidence: what the engine sees."""
        if work_id not in self.works:
            raise catalog_error([f"{work_id}: not in the query graph (reviewed works only)"])
        return dump_work(self.works[work_id])

    # ---------------- recommend ----------------

    def recommend(self, context_path):
        """recommend from a taste context file. returns a canonical mapping."""
        doc = load_context(context_path)
        errors = validate_context(doc, set(self.works), self._vocab_for_context(), filename=str(context_path))
        if errors:
            raise catalog_error(errors)
        context = _normalized_context(doc)

        supports, affinities, ignored = self._supports(context)
        candidates = self._candidates(context, supports, affinities)
        result = {
            "query": "recommend",
            "taste_context_version": context_version,
            "ignored_as_incidental": ignored,
            "profile": _profile_view(supports, affinities),
            "candidates": candidates,
        }
        return result

    def _vocab_for_context(self):
        # axis -> values view for context validation
        view = {}
        for (axis, value) in self.vocab:
            view.setdefault(axis, {"layer": self.vocab[(axis, value)]["layer"], "select": self.vocab[(axis, value)]["select"], "values": []})
            view[axis]["values"].append(value)
        return view

    def _supports(self, context):
        """per-trait support from liked works, honoring incidental marks."""
        role_w = self.role_weights
        strength_w = self.strengths
        supports = {}
        affinities = {}
        ignored = []
        global_incidental = {(t["axis"], t["value"]) for t in context["incidental"] if t["work"] is None}
        work_incidental = {}
        for t in context["incidental"]:
            if t["work"] is not None:
                work_incidental.setdefault(t["work"], set()).add((t["axis"], t["value"]))

        for liked in context["liked"]:
            wid = liked["work"]
            strength = strength_w[liked["strength"]]
            for axis, value, role in _work_trait_list(self.works[wid]):
                key = (axis, value)
                if key in work_incidental.get(wid, set()) or key in global_incidental:
                    ignored.append({"work": wid, "trait": f"{axis}/{value}"})
                    continue
                supports[key] = supports.get(key, 0.0) + role_w[role] * strength

        # compound affinities: support from liked works carrying all traits
        for affinity in context["affinities"]:
            keys = [(t["axis"], t["value"]) for t in affinity["all_of"]]
            total = 0.0
            for liked in context["liked"]:
                wid = liked["work"]
                if all(self._carries(wid, key) for key in keys):
                    total += strength_w[liked["strength"]]
            if total > 0:
                affinities[affinity["id"]] = {"all_of": [f"{a}/{v}" for a, v in keys], "support": total}
        return supports, affinities, ignored

    def _carries(self, work_id, trait_key):
        return trait_key in self.traits and work_id in self.traits[trait_key]

    def _candidates(self, context, supports, affinities):
        liked_ids = {l["work"] for l in context["liked"]}
        # avoid: drop candidates carrying every trait in a rule's all_of
        pool = []
        for wid, doc in self.works.items():
            if wid in liked_ids:
                continue
            if any(all(self._carries(wid, (t["axis"], t["value"])) for t in rule["all_of"]) for rule in context["avoid"]):
                continue
            pool.append(wid)

        max_support = max(supports.values(), default=0.0)
        max_affinity = max((a["support"] for a in affinities.values()), default=0.0)
        affinity_weights = {}
        for aff_id, info in affinities.items():
            keys = tuple(tuple(s.split("/", 1)) for s in info["all_of"])
            weight = sum(self.axis_weights[a] for a, v in keys) / len(keys)
            affinity_weights[aff_id] = weight

        scored = []
        for wid in pool:
            doc = self.works[wid]
            contributions = []
            for key, support in supports.items():
                axis, value = key
                if self._carries(wid, key):
                    role = self.traits[key][wid]
                    c = self.axis_weights[axis] * (support / max_support if max_support else 0) * self.role_weights[role]
                    contributions.append({"trait": f"{axis}/{value}", "contribution": c})
            for aff_id, info in affinities.items():
                keys = [tuple(s.split("/", 1)) for s in info["all_of"]]
                if all(self._carries(wid, k) for k in keys):
                    c = affinity_weights[aff_id] * (info["support"] / max_affinity if max_affinity else 0)
                    contributions.append({"trait": f"affinity/{aff_id}", "contribution": c})
            raw = sum(c["contribution"] for c in contributions)
            scored.append((wid, raw, contributions))

        if not scored:
            return []
        best = max(raw for wid, raw, contributions in scored) or 1.0
        results = []
        for wid, raw, contributions in scored:
            shares = _shares(contributions)
            pyramid = self._priority_pyramid(context, wid)
            score = round(raw / best, 4) if best else 0.0
            results.append({
                "work": wid,
                "title": self.works[wid]["title"],
                "score": score,
                "priority": pyramid,
                "shares": shares,
            })
        # priority gate: matched vector lexicographic (top tier first), then score, then slug
        results.sort(key=lambda r: (
            tuple(-int(p["matched"]) for p in r["priority"]),
            -r["score"], r["work"]))
        return results

    def _priority_pyramid(self, context, wid):
        pyramid = []
        for tier, item in enumerate(context["priority"], start=1):
            if "affinity" in item:
                aff = next(a for a in context["affinities"] if a["id"] == item["affinity"])
                matched = all(self._carries(wid, (t["axis"], t["value"])) for t in aff["all_of"])
                pyramid.append({"tier": tier, "affinity": item["affinity"], "matched": matched})
            else:
                matched = self._carries(wid, (item["axis"], item["value"]))
                pyramid.append({"tier": tier, "trait": f"{item['axis']}/{item['value']}", "matched": matched})
        return pyramid


def _normalized_context(doc):
    """fill defaults so downstream code never re-checks shapes.
    incidental entries are flattened: {work, axis, value}."""
    incidental = [
        {"work": e.get("work"), "axis": e["trait"]["axis"], "value": e["trait"]["value"]}
        for e in doc.get("incidental") or []
    ]
    return {
        "taste_context_version": doc.get("taste_context_version", context_version),
        "liked": doc.get("liked") or [],
        "incidental": incidental,
        "affinities": doc.get("affinities") or [],
        "priority": doc.get("priority") or [],
        "avoid": doc.get("avoid") or [],
    }


def _shares(contributions):
    """attribution across tags: shares sum to exactly 100.0 (largest remainder)."""
    total = sum(c["contribution"] for c in contributions)
    if total <= 0:
        return []
    # sum contributions per trait first (a trait appears once per candidate)
    order = sorted(contributions, key=lambda c: (-c["contribution"], c["trait"]))
    scaled = [100.0 * c["contribution"] / total for c in order]
    floors = [int(s) for s in scaled]
    remainder = round(100.0 - sum(floors), 1)
    # distribute the remainder by largest fractional part, ties by trait slug
    fracs = sorted(range(len(scaled)), key=lambda i: (-(scaled[i] - floors[i]), order[i]["trait"]))
    tenths = [round(scaled[i] * 10) for i in range(len(scaled))]
    # work in tenths for exact 100.0 accounting
    tenths_sum = sum(tenths)
    delta = 1000 - tenths_sum
    for i in fracs[:delta] if delta > 0 else []:
        tenths[i] += 1
    if delta < 0:
        for i in reversed(fracs):
            if delta == 0:
                break
            if tenths[i] > 0:
                tenths[i] -= 1
                delta += 1
    shares = []
    for i, c in enumerate(order):
        shares.append({"trait": c["trait"], "share": tenths[i] / 10.0})
    return shares


def _profile_view(supports, affinities):
    """the "what you actually like" view: supported traits, strongest first."""
    view = []
    for (axis, value), support in supports.items():
        view.append({"trait": f"{axis}/{value}", "support": round(support, 4)})
    view.sort(key=lambda t: (-t["support"], t["trait"]))
    for aff_id, info in sorted(affinities.items()):
        view.append({"trait": f"affinity/{aff_id}", "all_of": info["all_of"], "support": round(info["support"], 4)})
    return view
