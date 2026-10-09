# Vendored KaTeX 0.19.0

Upstream: https://github.com/KaTeX/KaTeX
Package: https://registry.npmjs.org/katex/-/katex-0.19.0.tgz
Package SHA-512 integrity:
`sha512-v6Tznz3zJ7u3niRCoDTsumM2+HA2XXcCu+WAacCeHD2z3p9A9Ks987o5FzfTGBN0e8A0vjEgIDvLbICrXpdw/Q==`

`katex.mjs`, `katex.min.css`, and `fonts/*.{woff2,woff,ttf}` are unmodified
copies of package `dist/` files. `LICENSE` is the package MIT license.
`fonts/LICENSE` additionally retains the MIT font notice from the archived
https://github.com/KaTeX/katex-fonts repository (Copyright 2018 Khan Academy).

To update deliberately, fetch a pinned npm package with `npm pack katex@VERSION`
in a temporary directory, verify its published integrity, and copy only these
runtime files and licenses. Recheck reserved-command validation, safe options,
font references, both native-browser rendering workflows and package inspection.
The application does not depend on node_modules or an install/build step. No
runtime resources are loaded from the network.
