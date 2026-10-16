"""cli for the phase 0 toolchain: build, check, check-context, dump.

usage (from repo root):
  python3 -m src.cli build [--works dir] [--vocab dir] [--db path]
  python3 -m src.cli check [--works dir] [--vocab dir]
  python3 -m src.cli check-context context.yaml [--works dir] [--vocab dir]
  python3 -m src.cli dump work-id [--db path]
"""

import argparse
import sys

from .build.compiler import compile_db, load_works, read_work
from .build.vocab import catalog_error, load_vocab
from .build.works import dump
from .query.context import load_context, validate_context

default_vocab = "data/vocab"
default_works = "data/works"
default_db = "build/latent.db"


def _fail(messages):
    for m in messages:
        print(f"error: {m}", file=sys.stderr)
    sys.exit(1)


def cmd_build(args):
    vocab = load_vocab(args.vocab)
    works = load_works(args.works, vocab)
    compile_db(works, vocab, args.db)
    reviewed = sum(1 for w in works.values() if w.get("status") == "reviewed")
    print(f"built {len(works)} works ({reviewed} reviewed, {len(works) - reviewed} draft) into {args.db}")


def cmd_check(args):
    vocab = load_vocab(args.vocab)
    works = load_works(args.works, vocab)
    print(f"ok: {len(works)} valid works, {len(vocab)} vocab axes")


def cmd_check_context(args):
    vocab = load_vocab(args.vocab)
    works = load_works(args.works, vocab)
    doc = load_context(args.context)
    errors = validate_context(doc, set(works), vocab, filename=str(args.context))
    if errors:
        _fail(errors)
    print(f"ok: valid taste context ({len(doc.get('liked') or [])} liked works)")


def cmd_dump(args):
    doc = read_work(args.db, args.work_id)
    sys.stdout.write(dump(doc))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="latent", description="deterministic taste decomposition engine (phase 0)")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_source(p):
        p.add_argument("--vocab", default=default_vocab)
        p.add_argument("--works", default=default_works)

    p = sub.add_parser("build", help="validate works and compile the sqlite catalog")
    add_source(p)
    p.add_argument("--db", default=default_db)
    p.set_defaults(fn=cmd_build)

    p = sub.add_parser("check", help="validate works without writing anything")
    add_source(p)
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("check-context", help="validate a taste context file")
    add_source(p)
    p.add_argument("context")
    p.set_defaults(fn=cmd_check_context)

    p = sub.add_parser("dump", help="print one work from the database in canonical yaml")
    p.add_argument("work_id")
    p.add_argument("--db", default=default_db)
    p.set_defaults(fn=cmd_dump)

    args = parser.parse_args(argv)
    try:
        args.fn(args)
    except catalog_error as err:
        _fail(err.messages)


if __name__ == "__main__":
    main()
