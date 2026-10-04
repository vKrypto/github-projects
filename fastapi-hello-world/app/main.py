from fastapi import FastAPI

app = FastAPI(title="Hello World API")


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/health")
async def health():
    return {"status": "ok"}
