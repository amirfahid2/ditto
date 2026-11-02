# The connect pages

`/connect/`, `/connect1/` (teachers, principals, professors), `/connect2/` (physicians) and
`/connect3/` (executives) are one page, `template.html`, filled with the words and the demo
board of each audience in `personas.py`.

To change the page for every audience, edit `template.html`. To change one audience's words or
board, edit its entry in `personas.py`. Then, from the site's root:

    python3 connect/_build/build.py

and commit the generated `index.html` files together with the change.
