# AI Team: dashboard + orchestrator + agents in one image.
# Deliberately no git in the image: agents must not interact with git at all.
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Same UID/GID as the workstation user, so files the coder writes in /workspace stay yours.
ARG UID=1000
ARG GID=1000
RUN groupadd -g ${GID} agent && useradd -u ${UID} -g ${GID} -m agent && mkdir -p /data && chown agent:agent /data
USER agent

# Claude Code CLI for AI_TEAM_AGENT_BACKEND=cli (official native installer, to ~/.local/bin).
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/home/agent/.local/bin:$PATH DISABLE_AUTOUPDATER=1

# OpenAI Codex CLI for AI_TEAM_AGENT_BACKEND=codex (pinned release binary).
ARG CODEX_VERSION=0.160.0
RUN curl -fsSL "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-x86_64-unknown-linux-musl.tar.gz" \
      | tar xz -C /tmp && mv /tmp/codex-x86_64-unknown-linux-musl /home/agent/.local/bin/codex

COPY ai_team ai_team
COPY dashboard dashboard

ENV AI_TEAM_WORKSPACE_ROOT=/workspace \
    AI_TEAM_DB_PATH=/data/tasks.db \
    AI_TEAM_HIDDEN_DIRS='["/workspace/ai-team"]' \
    AI_TEAM_CODEX_HOME=/data/codex
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/meta', timeout=4)"
CMD ["python", "-m", "ai_team", "--host", "0.0.0.0", "--port", "8765"]
