from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from app.ai import router as ai_router
from app.auth import router as auth_router
from app.board import router as board_router
from app.database import initialize_database


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    initialize_database()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])
app.include_router(auth_router)
app.include_router(board_router)
app.include_router(ai_router)


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello from the API!"}


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
