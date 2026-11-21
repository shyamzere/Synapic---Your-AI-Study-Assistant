"""
Shared pytest setup.

Tests never load the real embedding model or call Groq. Instead:
  - FakeEmbedder turns text into a "bag of words" vector, so texts that share
    words get similar vectors. That's enough to check ranking logic.
  - Groq is replaced by a function that records the messages it was sent.
"""

import sys
import zlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

# Make `import main` / `import rag` work when pytest runs from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402
import rag  # noqa: E402


class FakeEmbedder:
    def __init__(self):
        self.calls: list[list[str]] = []

    def embed(self, texts, batch_size=32):
        texts = list(texts)
        self.calls.append(texts)
        for text in texts:
            vector = np.zeros(384, dtype=np.float32)
            for word in text.lower().split():
                word = word.strip(".,!?;:()[]\"'")
                if len(word) > 3:  # skip tiny stop-words like "the", "is"
                    # crc32 is stable across runs (Python's hash() is not)
                    vector[zlib.crc32(word.encode()) % 384] += 1.0
            yield vector

    @property
    def embedded_text_count(self) -> int:
        return sum(len(batch) for batch in self.calls)


@pytest.fixture
def fake_embedder(monkeypatch):
    embedder = FakeEmbedder()
    monkeypatch.setattr(rag, "get_embedder", lambda: embedder)
    rag.clear_index_cache()
    yield embedder
    rag.clear_index_cache()


@pytest.fixture
def fake_groq(monkeypatch):
    """Replace the Groq call; `fake_groq.messages` holds what was sent."""
    recorder = SimpleNamespace(messages=None, calls=0, answer="Mitochondria make ATP [1].")

    def fake_completion(messages, max_tokens=main.CHAT_MAX_TOKENS):
        recorder.messages = messages
        recorder.max_tokens = max_tokens
        recorder.calls += 1
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=recorder.answer))]
        )

    monkeypatch.setattr(main, "create_messages_completion", fake_completion)
    return recorder


@pytest.fixture
def client(fake_embedder, fake_groq):
    from fastapi.testclient import TestClient

    # Fresh daily budgets and no slowapi limits, so tests don't affect each other.
    main.limiter.enabled = False
    main._budget_day = None
    main._client_groq_calls = {}
    with TestClient(main.app) as test_client:
        yield test_client
    main.limiter.enabled = True
