"""yaml -> sqlite compiler. the compiled database is the query graph's only input."""

import json
import sqlite3
from pathlib import Path

from .vocab import catalog_error
from .works import axis_order, layer1_fields, work_fields, validate_work, load_yaml

schema_sql = """
-- the compiled database is derived data: dropped and rebuilt each run
drop table if exists works;
drop table if exists work_links;
drop table if exists trait_values;
drop table if exists work_traits;

create table if not exists works (
  id text primary key,
  title text not null,
  medium text not null,
  unit text not null,
  first_release integer not null,
  origin text not null,
  language text not null,
  creators text,
  external_ids text,
  status text not null,
  tag_version integer not null,
  tagged_by text,
  date text,
  genre_tradition text,
  setting_geo text,
  setting_era text,
  lead_performers text,
  setting_scale text,
  crime_module text
);

create table if not exists work_links (
  from_work text not null,
  to_work text not null,
  kind text not null,
  primary key (from_work, to_work, kind)
);

create table if not exists trait_values (
  axis text not null,
  value text not null,
  layer integer not null,
  select_rule text not null,
  primary key (axis, value)
);

create table if not exists work_traits (
  work_id text not null,
  axis text not null,
  value text not null,
  role text not null,
  evidence text not null,
  ord integer not null,
  primary key (work_id, axis, value),
  foreign key (work_id) references works(id)
);

create index if not exists work_traits_axis on work_traits (axis, value);
"""


def load_works(works_dir, vocab):
    """load and validate every work yaml. raises catalog_error on any failure."""
    works = {}
    errors = []
    paths = sorted(Path(works_dir).glob("*.yaml"))
    if not paths:
        raise catalog_error([f"{works_dir}: no work files found"])
    for path in paths:
        doc = load_yaml(path)
        errors.extend(validate_work(doc, vocab, filename=str(path)))
        if doc.get("id"):
            if doc["id"] in works:
                errors.append(f"{path}: duplicate work id: {doc['id']}")
            else:
                works[doc["id"]] = doc
    # cross-file check: every link target exists
    for wid, doc in works.items():
        for link in doc.get("links") or []:
            target = link.get("work")
            if target and target not in works:
                errors.append(f"{wid}: link target not in catalog: {target}")
    if errors:
        raise catalog_error(errors)
    return works


def compile_db(works, vocab, db_path):
    """write the catalog to db_path. deterministic: same inputs, same database."""
    path = Path(db_path)
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    try:
        con.executescript(schema_sql)
        con.execute("delete from works")
        con.execute("delete from work_links")
        con.execute("delete from trait_values")
        con.execute("delete from work_traits")
        for axis, meta in sorted(vocab.items()):
            for value in meta["values"]:
                con.execute(
                    "insert into trait_values (axis, value, layer, select_rule) values (?, ?, ?, ?)",
                    (axis, value, meta["layer"], meta["select"]),
                )
        for wid, doc in works.items():
            con.execute(
                "insert into works (id, title, medium, unit, first_release, origin, language,"
                " creators, external_ids, status, tag_version, tagged_by, date,"
                " genre_tradition, setting_geo, setting_era, lead_performers, setting_scale, crime_module)"
                " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    doc["id"], doc["title"], doc["medium"], doc["unit"], doc["first_release"],
                    json.dumps(doc["origin"]), doc["language"],
                    json.dumps(doc["creators"]) if doc.get("creators") is not None else None,
                    json.dumps(doc["external_ids"]) if doc.get("external_ids") is not None else None,
                    doc["status"], doc["tag_version"],
                    doc.get("tagged_by"), doc.get("date"),
                    json.dumps(doc["genre_tradition"]),
                    doc.get("setting_geo"),
                    json.dumps(doc["setting_era"]) if doc.get("setting_era") is not None else None,
                    json.dumps(doc["lead_performers"]) if doc.get("lead_performers") is not None else None,
                    doc.get("setting_scale"),
                    json.dumps(doc["crime_module"]) if doc.get("crime_module") else None,
                ),
            )
            for link in doc.get("links") or []:
                con.execute(
                    "insert or ignore into work_links (from_work, to_work, kind) values (?, ?, ?)",
                    (doc["id"], link["work"], link["kind"]),
                )
            # core axes first (axis order), then any optional axes present,
            # alphabetically, so authored files round-trip byte-identically.
            tag_axes = list(doc.get("tags", {}))
            ordered_axes = [a for a in axis_order if a in tag_axes]
            ordered_axes += sorted(set(tag_axes) - set(axis_order))
            for axis in ordered_axes:
                for n, tag in enumerate(doc.get("tags", {}).get(axis, [])):
                    con.execute(
                        "insert into work_traits (work_id, axis, value, role, evidence, ord)"
                        " values (?, ?, ?, ?, ?, ?)",
                        (doc["id"], axis, tag["value"], tag["role"], tag["evidence"], n),
                    )
        con.commit()
    finally:
        con.close()


def read_work(db_path, work_id):
    """read one work back from the database as a normalized mapping.

    used for the round-trip check: dump(read_work(db, id)) must equal the
    original file for canonically authored files.
    """
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        row = con.execute("select * from works where id = ?", (work_id,)).fetchone()
        if row is None:
            raise catalog_error([f"{work_id}: not found in database"])
        doc = {field: row[field] for field in work_fields}
        for field in ("origin", "creators", "external_ids"):
            if doc[field] is not None:
                doc[field] = json.loads(doc[field])
        for field in layer1_fields:
            if row[field] is not None:
                value = row[field]
                if field in ("genre_tradition", "setting_era", "lead_performers"):
                    value = json.loads(value)
                doc[field] = value
        if row["crime_module"]:
            doc["crime_module"] = json.loads(row["crime_module"])
        tags = {}
        for t in con.execute(
            "select axis, value, role, evidence from work_traits where work_id = ? order by axis, ord",
            (work_id,),
        ).fetchall():
            tags.setdefault(t["axis"], []).append(
                {"value": t["value"], "role": t["role"], "evidence": t["evidence"]}
            )
        if tags:
            ordered = {}
            for axis in axis_order:
                if axis in tags:
                    ordered[axis] = tags[axis]
            for axis in sorted(tags):
                if axis not in ordered:
                    ordered[axis] = tags[axis]
            doc["tags"] = ordered
        links = [
            {"work": l["to_work"], "kind": l["kind"]}
            for l in con.execute(
                "select to_work, kind from work_links where from_work = ? order by kind, to_work",
                (work_id,),
            ).fetchall()
        ]
        if links:
            doc["links"] = links
        return doc
    finally:
        con.close()
