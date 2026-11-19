import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import require_same_origin, require_user

router = APIRouter(prefix="/api")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
OPENROUTER_TIMEOUT_SECONDS = 20


def check_openrouter() -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenRouter is not configured. Set OPENROUTER_API_KEY in the project root .env and restart the app.",
        )

    request = Request(
        OPENROUTER_URL,
        data=json.dumps(
            {
                "model": OPENROUTER_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": "What is 2 + 2? Reply with only the single character 4.",
                    }
                ],
            }
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=OPENROUTER_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read())
    except HTTPError as error:
        if error.code in (401, 403):
            detail = "OpenRouter rejected the API key or its permissions. Check OPENROUTER_API_KEY."
        elif error.code == 402:
            detail = "OpenRouter reports that the account has insufficient credits."
        elif error.code == 404:
            detail = f"OpenRouter could not find the configured model: {OPENROUTER_MODEL}."
        elif error.code == 429:
            detail = "OpenRouter rate limit or model quota reached. Try again later."
        elif error.code == 400:
            detail = f"The configured model rejected the connectivity check: {OPENROUTER_MODEL}."
        elif error.code >= 500:
            detail = f"OpenRouter is temporarily unavailable (HTTP {error.code})."
        else:
            detail = f"OpenRouter returned an unexpected HTTP error ({error.code})."
        raise HTTPException(status_code=502, detail=detail) from None
    except (URLError, TimeoutError):
        raise HTTPException(
            status_code=502,
            detail="Could not reach OpenRouter. Check network connectivity and try again.",
        ) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(
            status_code=502,
            detail="OpenRouter returned an invalid response for the configured model.",
        ) from None

    try:
        answer = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise HTTPException(
            status_code=502,
            detail="OpenRouter returned an invalid response for the configured model.",
        ) from None

    if not isinstance(answer, str) or answer.strip() != "4":
        raise HTTPException(
            status_code=502,
            detail=f"The configured model did not return the expected answer: {OPENROUTER_MODEL}.",
        )
    return answer.strip()


@router.post(
    "/ai/check",
    dependencies=[Depends(require_same_origin)],
)
def connectivity_check(
    response: Response,
    _username: str = Depends(require_user),
) -> dict[str, str]:
    answer = check_openrouter()
    response.headers["Cache-Control"] = "no-store"
    return {"answer": answer, "model": OPENROUTER_MODEL}
