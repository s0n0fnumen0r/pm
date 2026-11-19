import secrets
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/api")
SESSION_COOKIE = "kanban_session"
SESSION_TTL_SECONDS = 8 * 60 * 60
sessions: dict[str, tuple[str, float]] = {}
sessions_lock = Lock()


class Credentials(BaseModel):
    username: str
    password: str


def require_same_origin(request: Request) -> None:
    expected = f"{request.url.scheme}://{request.url.netloc}"
    if request.headers.get("origin") != expected:
        raise HTTPException(status_code=403, detail="Invalid request origin")


def require_user(request: Request) -> str:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    with sessions_lock:
        session = sessions.get(token)
        if not session:
            raise HTTPException(status_code=401, detail="Session expired")
        username, expires_at = session
        if expires_at <= monotonic():
            del sessions[token]
            raise HTTPException(status_code=401, detail="Session expired")
    return username


@router.post("/login", dependencies=[Depends(require_same_origin)])
def login(credentials: Credentials, request: Request, response: Response) -> dict[str, str]:
    if credentials.username != "user" or credentials.password != "password":
        raise HTTPException(status_code=401, detail="Invalid username or password")

    now = monotonic()
    old_token = request.cookies.get(SESSION_COOKIE)
    token = secrets.token_urlsafe(32)
    with sessions_lock:
        expired = [key for key, (_, expiry) in sessions.items() if expiry <= now]
        for key in expired:
            del sessions[key]
        if old_token:
            sessions.pop(old_token, None)
        sessions[token] = (credentials.username, now + SESSION_TTL_SECONDS)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"username": credentials.username}


@router.get("/session")
def session(response: Response, username: str = Depends(require_user)) -> dict[str, str]:
    response.headers["Cache-Control"] = "no-store"
    return {"username": username}


@router.post("/logout", dependencies=[Depends(require_same_origin), Depends(require_user)])
def logout(request: Request, response: Response) -> dict[str, str]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with sessions_lock:
            sessions.pop(token, None)
    response.delete_cookie(SESSION_COOKIE, httponly=True, samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return {"message": "Signed out"}
