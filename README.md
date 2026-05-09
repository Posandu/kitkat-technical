## Setup

### Prerequisites

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) if you don't have it:

### Install dependencies

```bash
uv sync
```

This reads `pyproject.toml` and `uv.lock`, creates a virtual environment (`.venv`), and installs all dependencies.

### Run

```bash
uv run main.py
```

`uv run` automatically uses the project's virtual environment, so there's no need to activate it manually.
