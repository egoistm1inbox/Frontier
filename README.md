# Frontier

This branch contains the two browser editor prototypes imported from
[`arena/8391e994-frontier`](https://github.com/SultanAladin/Frontier/tree/arena/8391e994-frontier)
at commit `63db1201d0cea199c7276c2126e62812b04821b9`:

- **Project Zero Editor:** `python3 Experimental/ProjectZeroEditor/Serve.py 8092`, then open `http://localhost:8092/`.
- **Frontier Editor:** `cd Experimental/FrontierEditor && npm ci && npm run dev -- --port 5173`, then open `http://localhost:5173/`.

Only the two editor directories were imported. Their native engine integrations and other linked experiments are not included; in particular, Frontier Editor's optional Construct backend is unavailable in this checkout. The editor previews themselves can run without it.
