#!/usr/bin/env python3
"""Builds the connect pages from template.html and personas.py.

    python3 connect/_build/build.py        # from the site's root

Writes connect/index.html, connect1/index.html, ... — commit those outputs too.
"""
import json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))
sys.path.insert(0, here)
from personas import PERSONAS

template = open(os.path.join(here, "template.html"), encoding="utf-8").read()

def js_string(s):
    return json.dumps(s, ensure_ascii=False)

def js_board(board):
    out = ["  var BOARD = ["]
    for sq in board:
        if sq.get("folder"):
            out.append("    { name: %s, folder: true, items: [" % js_string(sq["name"]))
            for child in sq["items"]:
                out.append("      { name: %s, text: %s }," % (js_string(child["name"]), js_string(child["text"])))
            out.append("    ] },")
        else:
            out.append("    { name: %s, text: %s }," % (js_string(sq["name"]), js_string(sq["text"])))
    out.append("  ];")
    return "\n".join(out)

for p in PERSONAS:
    assert len(p["board"]) == 9, "%s: the demo grid holds nine cells, got %d" % (p["path"], len(p["board"]))
    fill = {
        "TITLE": p["title"], "DESCRIPTION": p["description"], "OG_DESCRIPTION": p["og_description"],
        "PATH": p["path"], "EYEBROW": p["eyebrow"], "LEDE": p["lede"], "LIKE_WHAT": p["like_what"],
        "AVATAR": p["avatar"], "CONTACT": p["contact"], "OPENER": p["opener"], "BOARD": js_board(p["board"]),
    }
    html = template
    for key, value in fill.items():
        assert "</script" not in value.lower(), key
        html = html.replace("{{%s}}" % key, value)
    left = re.findall(r"\{\{(\w+)\}\}", html)
    assert not left, "unfilled: %s" % left
    out_dir = os.path.join(root, p["path"])
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print("wrote", os.path.relpath(out, root))
