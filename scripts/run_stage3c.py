#!/usr/bin/env python3
"""Execute the immutable Stage 3C evidence pass on real SubPipeMini2 tiles."""
from sagar.pipeline.stage3c import run_stage3c


if __name__ == "__main__":
    print(run_stage3c())
