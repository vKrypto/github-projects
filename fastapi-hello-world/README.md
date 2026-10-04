# FastAPI Hello World

Minimal FastAPI sample project with endpoints and test coverage.

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs at `http://localhost:8000/docs`.

## Test

```bash
pytest tests/
```
