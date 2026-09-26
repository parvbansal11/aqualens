# Aqualens Workstation

Internal desktop sonar-analysis workstation. It implements the five frozen product surfaces in
`../../docs/PRODUCT_SPEC.md` and consumes only `../../docs/API_CONTRACT.md` types.

## Run against the real Stage 3B API

```sh
cd apps/workstation
pnpm install
pnpm dev
```

Start the API with `uv run python scripts/serve_api.py`, then open `http://localhost:3000/`.
The workstation defaults to `NEXT_PUBLIC_DATA_SOURCE=api` and reads the immutable
`runs/run_internal_v2_evidence_v1` artifacts. The `/demo` route is retained only as a
test-fixture redirect and is never used by the production path.

## Connect the backend

To make the source explicit, copy `.env.example` to `.env.local`:

```dotenv
NEXT_PUBLIC_DATA_SOURCE=api
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Components depend on `WorkstationService`; switching adapters does not change the component
tree. Do not add API calls directly to components.

## Quality checks

```sh
pnpm test
pnpm lint
pnpm build
```
