# Single-process hackathon runtime. Build-time dependency installation only;
# the running container never invokes pip or downloads model artifacts.
FROM ghcr.io/astral-sh/uv:0.9.9 AS uv

FROM python:3.11-slim
COPY --from=uv /uv /uvx /bin/
WORKDIR /app

# Runtime libraries required by OpenCV / Ultralytics on Debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libxcb1 \
    libx11-6 \
    && rm -rf /var/lib/apt/lists/*


# Keep PyTorch CPU execution predictable on a small one-instance service.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    YOLO_AUTOINSTALL=false \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra inference --no-install-project

# These are the runtime code plus frozen inference/evidence inputs. The Docker
# context intentionally excludes source datasets and local runtime state.
COPY packages ./packages
COPY scripts/demo_serve.py ./scripts/demo_serve.py
COPY configs ./configs
COPY runs/run_stage3c_v4 ./runs/run_stage3c_v4
COPY data/processed/snap_2fa4bca0a0bc4b7d/split.json ./data/processed/snap_2fa4bca0a0bc4b7d/split.json
COPY data/processed/snap_2fa4bca0a0bc4b7d/tiles.jsonl ./data/processed/snap_2fa4bca0a0bc4b7d/tiles.jsonl
COPY ml/artifacts/final_v1/detector/best.pt ./ml/artifacts/final_v1/detector/best.pt
COPY ml/artifacts/final_v1/detector/metrics.json ./ml/artifacts/final_v1/detector/metrics.json
COPY ml/artifacts/vnext/open_set_v1/config.json ./ml/artifacts/vnext/open_set_v1/config.json
COPY ml/artifacts/vnext/open_set_v1/memory_bank.npz ./ml/artifacts/vnext/open_set_v1/memory_bank.npz
RUN test -s ml/artifacts/final_v1/detector/best.pt \
 && test "$(sha256sum ml/artifacts/final_v1/detector/best.pt | awk '{print $1}')" = "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15" \
 && test -s ml/artifacts/vnext/open_set_v1/config.json \
 && test -s ml/artifacts/vnext/open_set_v1/memory_bank.npz
RUN uv sync --frozen --no-dev --extra inference

EXPOSE 8000
CMD ["sh", "-c", "exec .venv/bin/uvicorn scripts.demo_serve:create_demo_app --factory --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
