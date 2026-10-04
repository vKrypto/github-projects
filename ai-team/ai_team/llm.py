"""Chat-model factory. Provider is global (settings.provider); the model is chosen per task tier."""
from functools import lru_cache

from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel

from .config import settings


def is_mock() -> bool:
    return settings.provider == "mock"


@lru_cache
def get_model(model: str) -> BaseChatModel:
    if is_mock():
        raise RuntimeError("mock provider has no chat model")
    kwargs = {}
    if settings.base_url:
        kwargs["base_url"] = settings.base_url
    if settings.api_key or settings.base_url:
        kwargs["api_key"] = settings.api_key or "unused"  # client insists on a key; keyless gateways ignore it
    return init_chat_model(model, model_provider=settings.provider, max_tokens=8192, timeout=300, **kwargs)


def model_for(tier: str) -> BaseChatModel:
    return get_model(settings.model_for_tier(tier))
