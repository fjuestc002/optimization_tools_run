# GS-OTA-sg13g2 — MIDAS proxy demo (offline, no Cadence required)

This example shows the built-in **MIDAS physics-informed surrogate** track:
a full NSGA-II optimization that runs entirely on precomputed device tables
(no simulator, no license, milliseconds per evaluation).

The circuit is a two-stage folded-cascade OTA in the IHP **SG13G2** open PDK
1.2 V domain. The device tables (`_pdk/sg13g2/mem/`) were generated offline
from the open SG13G2 models — see the attribution note in `_pdk/sg13g2/`.

## Setup (once)

1. Copy the folder `examples/GS-OTA-sg13g2/` into your projects root
   (default `~/optimization_tool/projects`, Windows:
   `C:\Users\<you>\optimization_tool\projects`).
2. Copy the table folder `_pdk/sg13g2/` into `<projects root>/_pdk/`
   (create `_pdk` if it does not exist). If you keep projects elsewhere,
   set the environment variable `MIDAS_PDK_ROOT` to the folder that
   contains `sg13g2/` instead.
3. Start the GUI and open project **GS-OTA-sg13g2**.

## Run

The bundled `config.txt` already selects the surrogate track
(`ai_type=gsieve`, `midas_pdk=auto`, `sieve_verify=0`). On start you should
see a `[PDK]` line in the log naming the selected table folder and the two
matched devices (`nsg`, `psg`) — that is the table-matching gate confirming
the project netlist against the bundled tables.

Expect the best gain around **50 dB** (proxy readout) after ~16×24
evaluations, with the whole run finishing in seconds. Points outside the
table domain are penalized, not crashes — that behavior is part of the demo.

Notes:

- `sieve_verify` (end-of-generation re-verification with real simulation)
  is **off** by default here on purpose: it needs a connected Cadence/Spectre
  session. This demo is fully offline by design.
- Numbers are surrogate readouts from public-model tables, not foundry-
  signoff quality results.
- These tables ship here **because** they derive from an open PDK
  (Apache-2.0). Foundry/closed-PDK tables cannot be redistributed at all:
  build them with the companion **collector** toolchain on your own PDK, or
  contact the author. See the MIDAS section of the top-level README.
