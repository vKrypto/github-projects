import argparse
import logging

import uvicorn

p = argparse.ArgumentParser(description="AI Team dashboard + orchestrator")
p.add_argument("--host", default="127.0.0.1")
p.add_argument("--port", type=int, default=8765)
args = p.parse_args()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
uvicorn.run("ai_team.api:app", host=args.host, port=args.port)
