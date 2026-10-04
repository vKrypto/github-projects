# FastAPI Hello World

A clean, standalone FastAPI sample project providing a simple "Hello World" API and health check endpoint.

## Project Structure

```text
fastapi-hello-world/
├── app/
│   ├── __init__.py
│   └── main.py
├── tests/
│   ├── __init__.py
│   └── test_main.py
├── README.md
└── requirements.txt
```

## Setup Instructions

1. **Create and activate a virtual environment (optional but recommended):**

   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

2. **Install dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

## Running the Application

Start the development server with hot-reload enabled:

```bash
uvicorn app.main:app --reload
```

Or run via Python directly:

```bash
python -m app.main
```

The server will start at `http://localhost:8000`.

## API Endpoints

- **Root:** `GET /` - Returns `{"message": "Hello World"}`
- **Health Check:** `GET /health` - Returns `{"status": "ok"}`
- **Interactive API Documentation (Swagger UI):** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Alternative API Documentation (ReDoc):** [http://localhost:8000/redoc](http://localhost:8000/redoc)

## Running Tests

Run the test suite using pytest:

```bash
pytest
```
