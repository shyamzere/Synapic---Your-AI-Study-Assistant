import json
import hashlib
import logging
import os
import re      # NEW: paragraph / sentence splitting
import threading
import time    # NEW: rate-limit delay between Groq calls
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List

from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse

ENV_PATH = Path(__file__).with_name(".env")
load_dotenv(dotenv_path=ENV_PATH)

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "https://synapicai.vercel.app,http://localhost:5173",
    ).split(",")
    if origin.strip()
]
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "").lower() in {"1", "true", "yes"}
logger = logging.getLogger(__name__)

# ── Sizing constants ─────────────────────────────────────────────────────────
# Each chunk sent to Groq must stay under this size.
# 10,000 chars ≈ 2,500 tokens, which leaves plenty of room for the system
# prompt plus a full JSON response inside Groq's context window.
CHUNK_SIZE = 10_000

# Hard ceiling on total raw user input BEFORE we even start chunking.
# 120,000 chars ≈ 90 dense A4 pages — more than enough for a whole semester.
MAX_INPUT_CHARS = 100_000
GUEST_MAX_INPUT_CHARS = 12_000
MAX_BODY_BYTES = 512 * 1024
SUPABASE_AUTH_TIMEOUT_SECONDS = 2.0
GROQ_TIMEOUT_SECONDS = 20.0
GROQ_MAX_TOKENS = 6000
AUTH_CACHE_SECONDS = 60
GUEST_DAILY_GROQ_CALL_LIMIT = 30
USER_DAILY_GROQ_CALL_LIMIT = 300
GLOBAL_DAILY_GROQ_CALL_LIMIT = 3_000
MAX_CONCURRENT_GENERATIONS = 3

# How many results to keep after merging chunks from all sections.
# Raise these later if students tell you they want more.
MAX_FLASHCARDS = 200
MAX_QUIZ_QUESTIONS = 100

# Pause between consecutive Groq calls to respect the rate limit.
# If you start seeing 429 errors on the free tier, raise this to 1.0.
CHUNK_DELAY = 0.5  # seconds

class BodySizeLimitMiddleware:
    """Buffer HTTP request bodies up to a fixed safe maximum before parsing."""

    def __init__(self, app, max_body_bytes: int):
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_body_bytes:
                    await JSONResponse(
                        {"detail": "Request body too large."}, status_code=413
                    )(scope, receive, send)
                    return
            except ValueError:
                await JSONResponse(
                    {"detail": "Invalid Content-Length header."}, status_code=400
                )(scope, receive, send)
                return

        body_parts = []
        total_size = 0
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            total_size += len(chunk)
            if total_size > self.max_body_bytes:
                await JSONResponse(
                    {"detail": "Request body too large."}, status_code=413
                )(scope, receive, send)
                return
            body_parts.append(chunk)
            more_body = message.get("more_body", False)

        body = b"".join(body_parts)
        sent = False

        async def replay_receive():
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_receive, send)


def get_client_ip(request: Request) -> str:
    """Use Render/Cloudflare's client-IP header and never trust XFF."""
    return request.headers.get(
        "cf-connecting-ip",
        request.client.host if request.client else "unknown",
    )


def get_verified_user_id(request: Request) -> str | None:
    cached_user_id = getattr(request.state, "verified_user_id", None)
    if getattr(request.state, "auth_checked", False):
        return cached_user_id

    request.state.auth_checked = True
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        request.state.verified_user_id = None
        return None

    token = authorization[7:].strip()
    if not token or not SUPABASE_URL or not SUPABASE_ANON_KEY:
        request.state.verified_user_id = None
        return None

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _auth_cache_lock:
        if len(_auth_cache) > 1_000:
            expired = [key for key, value in _auth_cache.items() if value[0] <= now]
            for key in expired:
                del _auth_cache[key]
        cached = _auth_cache.get(token_hash)
        if cached and cached[0] > now:
            request.state.verified_user_id = cached[1]
            return cached[1]

    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=SUPABASE_AUTH_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        user_id = response.json().get("id")
    except (httpx.HTTPError, ValueError, TypeError):
        request.state.verified_user_id = None
        return None

    if not isinstance(user_id, str) or not user_id:
        request.state.verified_user_id = None
        return None

    with _auth_cache_lock:
        _auth_cache[token_hash] = (now + AUTH_CACHE_SECONDS, user_id)
    request.state.verified_user_id = user_id
    return user_id


def rate_limit_key(request: Request) -> str:
    user_id = get_verified_user_id(request)
    return f"user:{user_id}" if user_id else f"ip:{get_client_ip(request)}"


limiter = Limiter(key_func=rate_limit_key)
app = FastAPI(
    title="Synapic API",
    docs_url="/docs" if ENABLE_DOCS else None,
    redoc_url="/redoc" if ENABLE_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_DOCS else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(BodySizeLimitMiddleware, max_body_bytes=MAX_BODY_BYTES)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

_auth_cache: dict[str, tuple[float, str]] = {}
_auth_cache_lock = threading.Lock()
_budget_lock = threading.Lock()
_budget_day = None
_global_groq_calls = 0
_client_groq_calls: dict[str, int] = {}
_generation_semaphore = threading.Semaphore(MAX_CONCURRENT_GENERATIONS)


# ── Pydantic models ──────────────────────────────────────────────────────────

class Flashcard(BaseModel):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class NotesInput(BaseModel):
    text: str = Field(min_length=1)


class FlashcardsResponse(BaseModel):
    flashcards: List[Flashcard]


class QuizOption(BaseModel):
    label: str   # A B C D
    text: str


class QuizQuestion(BaseModel):
    question: str
    options: List[QuizOption]
    correct: str   # A B C D
    explanation: str


class QuizResponse(BaseModel):
    quiz: List[QuizQuestion]


class SummaryResponse(BaseModel):
    title: str
    overview: str
    key_points: List[str]
    conclusion: str


# ── Core Groq helpers ────────────────────────────────────────────────────────

def check_text_length(
    text: str,
    max_characters: int,
    is_guest: bool,
) -> dict | None:
    """Return an error dict if text is over the absolute limit, else None."""
    if len(text) > max_characters:
        message = (
            f"Guest requests are limited to {GUEST_MAX_INPUT_CHARS:,} characters. "
            "Sign up free to paste up to 100,000 characters."
            if is_guest
            else f"Please keep it under {MAX_INPUT_CHARS:,} characters."
        )
        return {
            "error": "text_too_long",
            "message": message,
            "character_count": len(text),
            "max_characters": max_characters,
        }
    return None


def get_client() -> Groq:
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="The AI service failed. Please try again.",
        )
    return Groq(api_key=GROQ_API_KEY, timeout=GROQ_TIMEOUT_SECONDS)


def create_chat_completion(prompt: str) -> Any:
    try:
        client = get_client()
        return client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=GROQ_MAX_TOKENS,
        )
    except HTTPException:
        raise
    except Exception as exc:
        error_str = str(exc)
        if "429" in error_str or "rate_limit" in error_str.lower():
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit",
                    "message": (
                        "The AI service is temporarily rate-limited. "
                        "Please wait 60 seconds and try again."
                    ),
                },
            ) from exc
        logger.exception("Groq chat completion failed")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "ai_error",
                "message": "The AI service failed. Please try again.",
            },
        ) from exc


def strip_code_fences(text: str) -> str:
    """Remove markdown code fences so we can safely JSON-parse the output."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("```")
        if len(parts) >= 2:
            cleaned = parts[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
    return cleaned.strip()


def extract_notes(
    payload: NotesInput,
    max_characters: int,
    is_guest: bool,
) -> str:
    notes = payload.text.strip()

    if not notes:
        raise HTTPException(status_code=400, detail="Notes cannot be empty.")

    length_error = check_text_length(notes, max_characters, is_guest)
    if length_error:
        raise HTTPException(status_code=400, detail=length_error)

    return notes


def reserve_groq_budget(
    request: Request,
    user_id: str | None,
    groq_call_count: int,
) -> None:
    global _budget_day, _global_groq_calls, _client_groq_calls

    today = datetime.now(timezone.utc).date()
    client_key = f"user:{user_id}" if user_id else f"ip:{get_client_ip(request)}"
    client_limit = USER_DAILY_GROQ_CALL_LIMIT if user_id else GUEST_DAILY_GROQ_CALL_LIMIT

    with _budget_lock:
        if _budget_day != today:
            _budget_day = today
            _global_groq_calls = 0
            _client_groq_calls = {}

        if _global_groq_calls + groq_call_count > GLOBAL_DAILY_GROQ_CALL_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "global_groq_budget_exceeded",
                    "message": "The daily AI capacity is exhausted. Please try again tomorrow.",
                },
            )

        used_calls = _client_groq_calls.get(client_key, 0)
        if used_calls + groq_call_count > client_limit:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "groq_budget_exceeded",
                    "message": "Your daily AI generation limit is exhausted. Please try again tomorrow.",
                },
            )

        _client_groq_calls[client_key] = used_calls + groq_call_count
        _global_groq_calls += groq_call_count


@contextmanager
def generation_slot():
    if not _generation_semaphore.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "service_busy",
                "message": "The AI service is busy. Please try again in a moment.",
            },
        )
    try:
        yield
    finally:
        _generation_semaphore.release()


def prepare_generation(
    request: Request,
    payload: NotesInput,
    is_summary: bool,
) -> tuple[str, list[str]]:
    user_id = get_verified_user_id(request)
    is_guest = user_id is None
    max_characters = GUEST_MAX_INPUT_CHARS if is_guest else MAX_INPUT_CHARS
    notes = extract_notes(payload, max_characters, is_guest)
    chunks = chunk_text(notes)
    groq_call_count = len(chunks) + (1 if is_summary and len(chunks) > 1 else 0)
    reserve_groq_budget(request, user_id, groq_call_count)
    return notes, chunks


# ── Chunking helpers ─────────────────────────────────────────────────────────

def chunk_text(text: str, max_chars: int = CHUNK_SIZE) -> list[str]:
    """
    Split *text* into a list of strings each no longer than *max_chars*.

    Why does the order of splitting matter?
    - Paragraph breaks are the most natural place to split — the LLM gets a
      complete train of thought in each chunk.
    - Sentence breaks are next best — at least each sentence is complete.
    - Hard cuts (last resort) only happen if a single sentence is enormous,
      e.g. a student pasted a wall of text with no punctuation at all.

    Never cuts a word in half, so the LLM never sees a broken token.
    """
    # Normalise Windows line endings, then split on blank lines (paragraphs)
    normalised = text.replace('\r\n', '\n')
    paragraphs = re.split(r'\n{2,}', normalised)

    # If the whole text is one giant paragraph, fall back to single-newline splits
    if len(paragraphs) == 1:
        paragraphs = normalised.split('\n')

    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks: list[str] = []
    current: str = ""

    for para in paragraphs:
        if len(para) > max_chars:
            # ── Paragraph too big → split on sentence boundaries ─────────────
            # The lookbehind (?<=[.!?]) keeps the punctuation attached to the
            # left sentence rather than orphaning it on the next line.
            sentences = re.split(r'(?<=[.!?])\s+', para)
            for sent in sentences:
                if len(current) + len(sent) + 1 > max_chars:
                    if current:
                        chunks.append(current.strip())
                    if len(sent) > max_chars:
                        # ── Single sentence still too big → hard cut ─────────
                        for start in range(0, len(sent), max_chars):
                            chunks.append(sent[start: start + max_chars])
                        current = ""
                    else:
                        current = sent
                else:
                    current = (current + " " + sent).strip() if current else sent
        else:
            # ── Paragraph fits — try appending to the running chunk ───────────
            candidate = (current + "\n\n" + para).strip() if current else para
            if len(candidate) > max_chars:
                if current:
                    chunks.append(current.strip())
                current = para
            else:
                current = candidate

    if current:
        chunks.append(current.strip())

    # Always return at least one element so callers don't need to handle empty lists
    return chunks or [text]


def deduplicate_flashcards(
    cards: list[Flashcard],
    max_cards: int = MAX_FLASHCARDS,
) -> list[Flashcard]:
    """
    Drop near-duplicate cards and cap the total at max_cards.

    'Near-duplicate' means the first 60 characters of the question are identical
    after lowercasing. This catches things like the same question generated
    from two overlapping chunks without being so aggressive that it removes
    legitimately similar-but-distinct questions.
    """
    seen: set[str] = set()
    result: list[Flashcard] = []
    for card in cards:
        key = card.question.lower().strip()[:60]
        if key not in seen:
            seen.add(key)
            result.append(card)
        if len(result) >= max_cards:
            break
    return result


def deduplicate_quiz(
    questions: list[QuizQuestion],
    max_q: int = MAX_QUIZ_QUESTIONS,
) -> list[QuizQuestion]:
    """Same dedup logic as deduplicate_flashcards but for QuizQuestion objects."""
    seen: set[str] = set()
    result: list[QuizQuestion] = []
    for q in questions:
        key = q.question.lower().strip()[:60]
        if key not in seen:
            seen.add(key)
            result.append(q)
        if len(result) >= max_q:
            break
    return result


def _summarise_text(text: str) -> SummaryResponse:
    """
    Ask Groq for one structured SummaryResponse from *text*.
    Called both for short inputs (single pass) and for the final merge step
    when the input was chunked (two-pass).
    """
    prompt = (
        "Summarise these study notes.\n"
        "Return valid JSON only — no markdown, no backticks, no explanation.\n"
        "Use exactly this format:\n"
        '{"title": "...", "overview": "5-10 sentence overview", '
        '"key_points": ["point 1", "point 2", "point 3"], "conclusion": "..."}\n\n'
        f"Notes:\n{text}"
    )
    try:
        response = create_chat_completion(prompt)
        raw_text = response.choices[0].message.content or ""
        cleaned = strip_code_fences(raw_text)
        data = json.loads(cleaned)
        return SummaryResponse.model_validate(data)
    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="The AI did not return valid JSON summary data.",
        ) from exc
    except Exception as exc:
        logger.exception("Summary generation failed")
        raise HTTPException(
            status_code=502,
            detail="The AI service failed. Please try again.",
        ) from exc


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "Synapic API is running"}


@app.post("/generate-flashcards", response_model=FlashcardsResponse)
@limiter.limit("10/minute;100/day")
def generate_flashcards(request: Request, payload: NotesInput):
    with generation_slot():
        notes, chunks = prepare_generation(request, payload, is_summary=False)
        return _generate_flashcards(notes, chunks)


def _generate_flashcards(notes: str, chunks: list[str]) -> FlashcardsResponse:

    all_cards: list[Flashcard] = []

    for i, chunk in enumerate(chunks):
        if i > 0:
            # Small delay between calls to respect Groq's rate limit.
            # The Groq SDK will raise a 429 if we go too fast, and our
            # create_chat_completion() will convert that into an HTTPException.
            time.sleep(CHUNK_DELAY)

        prompt = (
            "Turn these study notes into concise flashcards.\n"
            "Return valid JSON only - no markdown, no backticks, no explanation.\n"
            'Use exactly this format: [{"question": "...", "answer": "..."}]\n\n'
            f"Notes:\n{chunk}"
        )

        try:
            response = create_chat_completion(prompt)
            raw_text = response.choices[0].message.content or ""
            cleaned_text = strip_code_fences(raw_text)
            data = json.loads(cleaned_text)
            cards = [Flashcard.model_validate(item) for item in data]
            all_cards.extend(cards)
        except HTTPException:
            raise  # 429 / auth errors must propagate immediately
        except json.JSONDecodeError:
            # One bad chunk should not kill everything.
            # Log it and carry on — the other chunks may succeed.
            logger.warning(
                "Flashcard chunk %s/%s returned invalid JSON; skipping.",
                i + 1,
                len(chunks),
            )
            continue
        except Exception as exc:
            logger.exception("Flashcard generation failed")
            raise HTTPException(
                status_code=502,
                detail="The AI service failed. Please try again.",
            ) from exc

    if not all_cards:
        raise HTTPException(
            status_code=502,
            detail="The AI did not return valid JSON flashcards.",
        )

    final_cards = deduplicate_flashcards(all_cards)
    return FlashcardsResponse(flashcards=final_cards)


@app.post("/generate-quiz", response_model=QuizResponse)
@limiter.limit("10/minute;100/day")
def generate_quiz(request: Request, payload: NotesInput):
    with generation_slot():
        notes, chunks = prepare_generation(request, payload, is_summary=False)
        return _generate_quiz(notes, chunks)


def _generate_quiz(notes: str, chunks: list[str]) -> QuizResponse:

    all_questions: list[QuizQuestion] = []

    for i, chunk in enumerate(chunks):
        if i > 0:
            time.sleep(CHUNK_DELAY)

        prompt = (
            "Turn these study notes into a multiple choice quiz.\n"
            "Return valid JSON only — no markdown, no backticks, no explanation.\n"
            "Use exactly this format:\n"
            '[{"question": "...", "options": [{"label": "A", "text": "..."}, '
            '{"label": "B", "text": "..."}, {"label": "C", "text": "..."}, '
            '{"label": "D", "text": "..."}], "correct": "A", "explanation": "..."}]\n\n'
            f"Notes:\n{chunk}"
        )

        try:
            response = create_chat_completion(prompt)
            raw_text = response.choices[0].message.content or ""
            cleaned = strip_code_fences(raw_text)
            data = json.loads(cleaned)
            questions = [QuizQuestion.model_validate(q) for q in data]
            all_questions.extend(questions)
        except HTTPException:
            raise
        except json.JSONDecodeError:
            logger.warning(
                "Quiz chunk %s/%s returned invalid JSON; skipping.",
                i + 1,
                len(chunks),
            )
            continue
        except Exception as exc:
            logger.exception("Quiz generation failed")
            raise HTTPException(
                status_code=502,
                detail="The AI service failed. Please try again.",
            ) from exc

    if not all_questions:
        raise HTTPException(
            status_code=502,
            detail="The AI did not return valid JSON quiz data.",
        )

    final_questions = deduplicate_quiz(all_questions)
    return QuizResponse(quiz=final_questions)


@app.post("/generate-summary", response_model=SummaryResponse)
@limiter.limit("10/minute;100/day")
def generate_summary(request: Request, payload: NotesInput):
    with generation_slot():
        notes, chunks = prepare_generation(request, payload, is_summary=True)
        return _generate_summary(notes, chunks)


def _generate_summary(notes: str, chunks: list[str]) -> SummaryResponse:

    # ── Short input: single Groq call, done ──────────────────────────────────
    if len(chunks) == 1:
        return _summarise_text(chunks[0])

    # ── Long input: TWO-PASS summarisation ───────────────────────────────────
    #
    # Why two passes instead of just sending all chunks?
    #
    # We can't merge structured JSON summaries from multiple chunks easily —
    # each chunk would give its OWN title, overview, key_points, conclusion,
    # and simply concatenating them would produce a mess.
    #
    # Instead:
    #   Pass 1 — ask Groq for a short PLAIN-TEXT summary of each chunk
    #            (~3-5 sentences, ≈ 400 chars per chunk).
    #            For 12 chunks that's ≈ 4,800 chars total — well under CHUNK_SIZE.
    #
    #   Pass 2 — feed all the plain-text mini-summaries into _summarise_text()
    #            which produces the final structured SummaryResponse in one call.
    #            Groq sees a compact representation of the WHOLE document.

    chunk_summaries: list[str] = []

    for i, chunk in enumerate(chunks):
        if i > 0:
            time.sleep(CHUNK_DELAY)

        prompt = (
            "Write a brief summary (3-5 sentences) of these study notes.\n"
            "Return plain text only — no JSON, no markdown, no bullet points.\n\n"
            f"Notes:\n{chunk}"
        )

        try:
            response = create_chat_completion(prompt)
            summary_text = (response.choices[0].message.content or "").strip()
            if summary_text:
                chunk_summaries.append(summary_text)
        except HTTPException:
            raise
        except Exception as exc:
            # A failed chunk is recoverable — we'll just have slightly less context.
            logger.exception(
                "Summary chunk %s/%s failed; skipping.",
                i + 1,
                len(chunks),
            )
            continue

    if not chunk_summaries:
        raise HTTPException(
            status_code=502,
            detail="Failed to summarise any section of the notes.",
        )

    # Join chunk summaries with a visual separator so Groq understands the
    # document has multiple sections rather than one continuous text.
    combined = "\n\n---\n\n".join(chunk_summaries)

    # Pass 2: produce the final structured summary from the combined mini-summaries
    return _summarise_text(combined)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
