"""Runtime settings, read from env vars prefixed AI_TEAM_ (or ai-team/.env)."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent.parent  # ai-team/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_TEAM_", env_file=APP_DIR / ".env", extra="ignore")

    workspace_root: Path = APP_DIR.parent
    # Folders inside the workspace agents must never see (ai-team/ itself, wherever it is mounted).
    hidden_dirs: list[Path] = [APP_DIR]
    db_path: Path = APP_DIR / "data" / "tasks.db"

    provider: str = "mock"  # mock | anthropic | openai | ollama
    # OpenAI-compatible gateway (e.g. OmniRoute) when provider=openai; key may be blank for keyless gateways.
    base_url: str | None = None
    api_key: str | None = None
    model_fast: str = "claude-haiku-4-5-20251001"
    model_balanced: str = "claude-sonnet-5-5"
    model_deep: str = "claude-opus-5-5"
    model_triage: str = "claude-haiku-4-5-20251001"

    max_parallel: int = 1
    max_review_rounds: int = 2
    agent_max_steps: int = 40
    command_timeout: int = 120
    poll_interval: float = 2.0

    def model_for_tier(self, tier: str) -> str:
        return {"fast": self.model_fast, "deep": self.model_deep}.get(tier, self.model_balanced)


settings = Settings()
settings.workspace_root = settings.workspace_root.resolve()
settings.hidden_dirs = [p.resolve() for p in settings.hidden_dirs]
settings.db_path.parent.mkdir(parents=True, exist_ok=True)
