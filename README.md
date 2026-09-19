# optimization_tools — Run Release

This repository contains **prebuilt Windows executables** of the analog IC
parameter optimization tool (v0.1.1, hardened build), packaged with
PyInstaller. It is a *binary-only* release: no Python sources are included,
and all first-party modules are **compiled to native extensions (Cython
`.pyd`)** — readable Python code exists nowhere in the bundles. Download and
run — no Python installation required.

## What it is

Optimization Tools is a self-developed circuit-parameter optimizer that
**hangs off Cadence**: it connects to a live Virtuoso / Maestro session
(locally or over an SSH tunnel to a Linux host) and drives the optimization
loop in its own process — a wide choice of optimization algorithms, an **AI
surrogate layer** for accelerated convergence, quick integration of new
algorithms, and distributed parallel evaluation, behind a Qt desktop GUI.

![Optimization Tools in action: Cadence ADE (left), optimizer GUI with
convergence/Pareto plots (right). Sensitive library names redacted.](image/Readme.png)

```
┌──────────────────────────────────────┐
│  optimization_tool (native exe)      │
│  ┌────────────────────────────────┐  │
│  │  pymoo / Bayesian algorithms   │  │
│  │  (GA / NSGA-II / DE / PSO /    │  │
│  │   CMA-ES / MOEA/D / CTAEA …)   │  │
│  └────────────┬───────────────────┘  │
│               │                      │
│  ┌────────────▼───────────────────┐  │
│  │  AI surrogate (GP / RF / GBRT) │  │
│  │  cold start → predict →        │  │
│  │  verify → learn (incremental)  │  │
│  └────────────┬───────────────────┘  │
│               │ SKILL commands       │
│  ┌────────────▼───────────────────┐  │
│  │  virtuoso-bridge (SSH tunnel)  │  │
│  └────────────┬───────────────────┘  │
└───────────────┼──────────────────────┘
                │ SSH
┌───────────────▼──────────────────────┐
│  Linux (Virtuoso + Maestro)          │
│  └─ Spectre simulation               │
└──────────────────────────────────────┘
```

> 📖 **Full workflow guide:** [docs/MANUAL.pdf](docs/MANUAL.pdf)
> (tunnel setup → Cadence ADE setup → run → apply result).
> The GUI defaults to **English**; switch any time via menu bar
> **Language → 中文**.

## What it can do

### Optimizers (pymoo-powered, single & multi objective)

| Category | Algorithms |
|----------|-----------|
| Single-objective | GA, DE, PSO, CMA-ES |
| Multi-objective (2–3) | NSGA-II, R-NSGA-III, SPEA2, MOEA/D, NSGA-III |
| Many-objective (4+) | NSGA-III, MOEA/D, CTAEA |
| Bayesian (single) | bayes_gp, bayes_rf |
| Bayesian (multi) | bayes_mo (ParEGO) |

### AI surrogate assistance

The AI layer replaces selected costly Spectre evaluations with fast model
predictions, in three phases:

1. **Cold start** — the first *N* evaluations run real simulations to build
   the training set (*N* = 0 when loading historical data);
2. **Prediction** — while model uncertainty stays below threshold, objectives
   are predicted without simulation;
3. **Verification & online learning** — when uncertainty exceeds threshold a
   real simulation runs and its result is fed back to the model.

| Model | Type | Best for |
|-------|------|----------|
| `local_gp` | Gaussian Process (RBF/Matérn) | smooth response surfaces, small samples |
| `random_forest` | Random Forest regression | robustness to outliers, medium samples |
| `gradient_boosting` | Gradient Boosting + quantile | non-smooth responses, larger samples |

Trained data persists per project (`ai_models/` in the project folder) and is
**auto-detected on the next run**: variables matched by name (order changes
handled), cold start skipped, new data appended incrementally. Different
variable sets (topology changes) are rejected with a warning. The GUI exposes
a *history-model inheritance* switch and a *clear history* action.

### Ledgers, resume and plots

Every evaluation is persisted in the project CSV ledgers
(`project_all_results` / `project_all_history` / real-simulation records);
interrupted runs stop gracefully and later runs resume from the saved state.
Convergence, full-history and Pareto plots update live (double-click to
enlarge); the Pareto set feeds one-click write-back of chosen solutions to
the schematic via the bridge.

## What's in this repository

```
optimization_tools_run/
├── optimization_tool_gui/          ← main application (onedir bundle)
│   └── optimization_tool_gui.exe   ← run this
├── start_bridge_launcher/          ← one-click Cadence bridge connector
│   └── start_bridge_launcher.exe   ← run this to open the SSH tunnel + bridge
├── examples/OTA-5/                 ← sample project (generic 5-T OTA, dry-run data)
├── docs/MANUAL.pdf                 ← English user manual (workflow guide)
├── image/Readme.png                ← demo screenshot (redacted)
└── README.md
```

## Requirements

- Windows 10/11 x64 (the `dist` folders must stay together — the `.exe` needs
  its sibling `_internal/` directory).
- Nothing else is installed by or for this app: all Python dependencies
  (numpy, pandas, pymoo, scikit-learn, scipy, joblib, requests, PySide6,
  matplotlib, …) are frozen inside the bundles.
- For real optimization runs: a Cadence Virtuoso + Maestro environment
  reachable over SSH (typically a Linux VM). The tool can still be fully
  evaluated in **dry-run** mode without Cadence — see below.
- Windows SmartScreen may warn on first launch ("unrecognized app") — choose
  *More info → Run anyway*, or unblock the exe in Properties.

## Quick start (no Cadence needed)

1. Run `optimization_tool_gui/optimization_tool_gui.exe`.
2. Create a new project, or point the project folder at
   `examples/OTA-5/` included here — it contains a complete sample:

   | File | Purpose |
   |------|---------|
   | `config.txt` | algorithm + generations/population + AI switches (`dry_run=True` makes it run without simulations) |
   | `I_scripts/variables.csv` | 9 design variables (mirror ratios, W/L, compensation cap) with ranges |
   | `I_scripts/specs.csv` | objective/spec list (Gain > 85 dB, PM > 60°) |
   | `I_scripts/outputs_*_maestro.csv` | example Maestro export (model-library name replaced by a placeholder) |
   | `project_*.csv` | evaluation ledger files produced by past runs (results / history / real-simulations) |

3. Set `dry_run=True` in `config.txt` and start the run: the GA/NSGA-II loop,
   AI surrogate cold-start → predict → verify cycle, convergence plots and the
   Pareto front all execute on synthetic responses, so you can evaluate the
   whole workflow before wiring a simulator.

## Cadence connection (real runs)

1. Configure the bridge: edit `start_bridge_launcher/_internal/virtuoso_bridge/resources/.env_template`
   (see the commented setups inside) — set your VM/server host, user and SSH
   key, then save it as `.env` in the same directory.
2. Run `start_bridge_launcher/start_bridge_launcher.exe`: it checks the SSH
   agent, opens the tunnel, and starts the bridge service in one click.
   Then load the printed `virtuoso_setup.il` line into the Virtuoso CIW.
3. In the GUI, the Bridge panel connects over the local tunnel; switch
   `dry_run=False` and start the optimization.

## Notes

- This is a *compiled* distribution: the tool's own Python modules were
  transpiled with Cython into native `.pyd` extensions before freezing, so no
  `.py` or `.pyc` of the application logic ships in the bundle. The only
  first-party `.py` files are the Virtuoso daemon scripts under
  `start_bridge_launcher/_internal/virtuoso_bridge/virtuoso/basic/resources/`
  (text resources that must be loaded *as source* into the Cadence CIW).
- Example data intentionally uses generic circuit parameters; the
  model-library name in the sample CSV is a placeholder
  (`example_models.lib`), not any foundry PDK file; library references in the
  screenshot above are redacted.
- **This release is GUI-only.** The underlying source project also has a
  Python CLI (`python -m optimization_tool …`); its switches and options are
  expressed here through the GUI and `config.txt`, not through exe
  command-line flags.

## License & disclaimer

This is a **binary-only release**: the first-party application is distributed
as precompiled native binaries under all rights reserved — no source license
is granted for our code, so this repository intentionally ships no OSI-style
license file for the application itself.

**Warranty disclaimer:** we guarantee that the self-developed code in this
distribution contains no malicious content; we **cannot** guarantee that the
third-party open-source components and their (transitive) dependencies we
reference are free of malice or risk. Use at your own discretion. Each
third-party component remains under its own license; the corresponding license
and copyright texts ship inside the bundles (see
`*/_internal/*.dist-info/LICENSE*`).

The software is provided "as is", without warranty of any kind, express or
implied.
