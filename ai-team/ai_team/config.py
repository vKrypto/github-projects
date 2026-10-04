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

    # Who runs the agents:
    #   claude    = Claude Code headless (subscription token from `claude setup-token`)
    #   codex     = OpenAI Codex CLI headless (ChatGPT subscription, device login)
    #   langchain = LangChain loop + our tools.py, via `provider`
    agent_backend: str = "langchain"
    claude_bin: str = "claude"
    claude_token_file: Path = Path("/run/secrets/claude_oauth_token")
    cli_model_fast: str = "haiku"
    cli_model_balanced: str = "sonnet"
    cli_model_deep: str = "opus"
    cli_model_triage: str = "haiku"
    cli_max_budget_usd: float | None = None
    codex_bin: str = "codex"
    codex_home: Path = Path("/home/agent/.codex")
    # Empty = the Codex default model for your plan; tiers also map to reasoning effort low/medium/high.
    codex_model_fast: str = ""
    codex_model_balanced: str = ""
    codex_model_deep: str = ""
    codex_model_triage: str = ""

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
    checkpoint_db: Path | None = None    # set below, next to db_path
    claude_config_dir: Path | None = None

    @property
    def backend(self) -> str:
        return "claude" if self.agent_backend == "cli" else self.agent_backend  # "cli" = old name for claude

    @property
    def backend_label(self) -> str:
        return {"claude": "claude-cli", "codex": "codex-cli"}.get(self.backend, self.provider)

    def codex_model_for_tier(self, tier: str) -> str:
        return {"fast": self.codex_model_fast, "deep": self.codex_model_deep}.get(tier, self.codex_model_balanced)

    def model_for_tier(self, tier: str) -> str:
        if self.backend == "claude":
            return {"fast": self.cli_model_fast, "deep": self.cli_model_deep}.get(tier, self.cli_model_balanced)
        if self.backend == "codex":
            from .codex_cli import model_label
            return model_label(tier)
        return {"fast": self.model_fast, "deep": self.model_deep}.get(tier, self.model_balanced)


settings = Settings()
settings.workspace_root = settings.workspace_root.resolve()
settings.hidden_dirs = [p.resolve() for p in settings.hidden_dirs]
settings.db_path.parent.mkdir(parents=True, exist_ok=True)
# Persistent memory next to the task DB (in the stack: /data, i.e. ai-team/data on the host).
settings.checkpoint_db = settings.db_path.parent / "checkpoints.db"
settings.claude_config_dir = settings.db_path.parent / "claude-home"  # Claude Code sessions, for --resume
settings.claude_config_dir.mkdir(exist_ok=True)
