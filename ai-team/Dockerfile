# AI Team: dashboard + orchestrator + agents in one image.
# Deliberately no git in the image: agents must not interact with git at all.
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY ai_team ai_team
COPY dashboard dashboard

# Same UID/GID as the workstation user, so files the coder writes in /workspace stay yours.
ARG UID=1000
ARG GID=1000
RUN groupadd -g ${GID} agent && useradd -u ${UID} -g ${GID} -m agent && mkdir -p /data && chown agent:agent /data
USER agent

ENV AI_TEAM_WORKSPACE_ROOT=/workspace \
    AI_TEAM_DB_PATH=/data/tasks.db \
    AI_TEAM_HIDDEN_DIRS='["/workspace/ai-team"]'
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/meta', timeout=4)"
CMD ["python", "-m", "ai_team", "--host", "0.0.0.0", "--port", "8765"]
