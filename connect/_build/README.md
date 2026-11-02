# The connect pages

`/connect/`, `/connect1/` (teachers, principals, professors), `/connect2/` (physicians),
`/connect3/` (executives) and `/connect4/` (the physicians' page in Persian) are one page,
`template.html`, filled with the words and the demo board of each audience in `personas.py`.

To change the page for every audience, edit `template.html`. To change one audience's words or
board, edit its entry in `personas.py`. The words every page shares (buttons, the guide's
conversation, the demo's notes, the keyboard's keys) live in `STRINGS` there, one entry per
language; a page in another language sets `"lang"` and writes its own words. Then, from the
site's root:

    python3 connect/_build/build.py

and commit the generated `index.html` files together with the change.
