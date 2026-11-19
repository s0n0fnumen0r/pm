from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from app.auth import router as auth_router

app = FastAPI()
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])
app.include_router(auth_router)


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello from the API!"}


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
