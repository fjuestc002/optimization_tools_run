# sg13g2 — MIDAS device tables (provenance / attribution)

- Circuit domain: IHP SG13G2 open PDK (Apache-2.0), 1.2 V LV devices.
- Devices: `nsg`, `psg` (SG13G2 LV NMOS / PMOS, simplified names as in the
  demo generator project; table name = netlist model name, strict match).
- Generation: offline table sweep (`dc.csv`) packed to v1 dual npz
  (`*_v1J.npz` / `*_v1V.npz`) — grid v2 (11 vds anchors), deterministic,
  zero foundry-confidential data involved.
- Axes: L ∈ {0.15 … 4 µm}, W ∈ {0.3 … 30 µm}, vds 11 anchors (0.01…1.2 V),
  vbs ∈ {0, 0.5, 1 V}; keep searched values inside these bounds.
- No `manifest.json` ships here on purpose: domain declaration stays empty
  (zero-declaration = zero clamping); out-of-domain points are penalized
  by the engine, which is part of the demo's teaching value.
