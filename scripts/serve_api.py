#!/usr/bin/env python3
"""Start the local Stage 3B API against generated run artifacts."""
from __future__ import annotations

import uvicorn

from sagar.api import create_app


if __name__ == "__main__":
    uvicorn.run(create_app(), host="127.0.0.1", port=8000)
