# web_3gpp_decode_encode

Single-machine internal pilot build for a 3GPP decoder and encoder web console.

## Overview

This repository now contains a minimal React + FastAPI monolith that reuses the existing Python decoder and NAS security scripts from `reference/tools/decode.py` and `reference/tools/nas_security.py`.

Current implementation scope:

1. Web UI for decode and encode round-trip.
2. NAS security encrypt and decrypt UI.
3. FastAPI backend wrapping the existing Python runtime.
4. Single Linux machine deployment target.
5. Schema and IE add/delete endpoints reserved as stubs for the next phase.

## Project Structure

```text
backend/
	app/
		main.py
		models.py
		services/
			protocol_runner.py
	requirements.txt
frontend/
	src/
		App.tsx
		api.ts
		styles.css
	package.json
reference/
	src/
	tools/
WEB_API_CONTRACT.md
```

## Backend Setup

Install backend dependencies:

```bash
./.venv/bin/python -m pip install -r backend/requirements.txt
```

Run the FastAPI service:

```bash
./.venv/bin/python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Notes:

1. `backend/requirements.txt` now includes the core runtime packages needed by the FastAPI service and the reference decoder script, including `pycrate` and `pycryptodome`.
2. The backend executes `reference/tools/decode.py` as a subprocess, so those dependencies must be installed in the same `.venv`.
3. `CryptoMobile` is still optional and only needed if you want NEA1/NIA1 or NEA3/NIA3 support.

## Frontend Setup

Install frontend dependencies:

```bash
cd frontend
npm install
```

Run the Vite dev server:

```bash
cd frontend
npm run dev
```

The frontend proxies `/api` requests to `http://127.0.0.1:8000` during development.

## Production-Like Local Build

Build the frontend bundle:

```bash
cd frontend
npm run build
```

After the `frontend/dist` directory exists, the FastAPI application will serve the built frontend bundle directly.

## Current Limitations

1. IE add and delete are not implemented in the first monolith build yet.
2. `/api/v1/protocol/schema/node`, `/api/v1/protocol/schema/template`, and `/api/v1/protocol/validate` currently return placeholders for the next phase.
3. Encode currently uses the existing legacy raw value structure returned by the reference Python script.
4. NAS structure-level add/delete is still unsupported.

## Next Recommended Step

Implement schema-driven canonical model conversion in the backend so the frontend can support:

1. Add previously absent optional IE.
2. Delete currently present optional IE.
3. Validate structural edits before encode.
