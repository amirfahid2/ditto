#!/usr/bin/env python3
"""Builds the connect pages from template.html and personas.py.

    python3 connect/_build/build.py        # from the site's root

Writes connect/index.html, connect1/index.html, ... — commit those outputs too.

A persona fills the template's {{PLACEHOLDERS}}: its own keys (TITLE, LEDE, BOARD, ...) and the
words of its language from STRINGS ({{S_KEY}} is the text as HTML, {{J_KEY}} the same as a JSON
value for the script). English is the base; another language only lists what it changes.
"""
import json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))
sys.path.insert(0, here)
from personas import PERSONAS, STRINGS

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

def head_extra(p):
    """The same page in another language, for search engines."""
    return "".join('<link rel="alternate" hreflang="%s" href="https://dittotap.com/%s/">\n' % (lang, path)
                   for lang, path in sorted(p.get("alternates", {}).items()))

for p in PERSONAS:
    assert len(p["board"]) == 9, "%s: the demo grid holds nine cells, got %d" % (p["path"], len(p["board"]))
    lang = p.get("lang", "en")
    words = dict(STRINGS["en"])
    words.update(STRINGS[lang])
    fill = {
        "TITLE": p["title"], "DESCRIPTION": p["description"], "OG_DESCRIPTION": p["og_description"],
        "PATH": p["path"], "EYEBROW": p["eyebrow"], "LEDE": p["lede"], "LIKE_WHAT": p["like_what"],
        "AVATAR": p["avatar"], "CONTACT": p["contact"], "OPENER": p["opener"], "BOARD": js_board(p["board"]),
        "LANG": lang, "DIR": "rtl" if words.get("rtl") else "ltr", "HEAD_EXTRA": head_extra(p),
    }
    for key, value in words.items():
        if key == "rtl":
            continue
        if isinstance(value, str):
            fill["S_" + key.upper()] = value
        fill["J_" + key.upper()] = json.dumps(value, ensure_ascii=False)

    def sub(m):
        key = m.group(1)
        assert key in fill, "%s: nothing to put in {{%s}}" % (p["path"], key)
        assert "</script" not in fill[key].lower(), key
        return fill[key]
    html = re.sub(r"\{\{(\w+)\}\}", sub, template)

    out_dir = os.path.join(root, p["path"])
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print("wrote", os.path.relpath(out, root))
