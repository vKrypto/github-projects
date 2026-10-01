"""Redis cache when configured; atomic tenant-scoped JSON files otherwise."""
import json, os, time, uuid
from pathlib import Path

class Cache:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.redis = None
        if os.getenv('REDIS_URL'):
            import redis
            self.redis = redis.Redis.from_url(os.environ['REDIS_URL'], socket_connect_timeout=2, socket_timeout=2)
    def get(self, tenant, key):
        if self.redis:
            try:
                value = self.redis.get(f'forma:{tenant}:{key}')
                if value: return json.loads(value)
            except Exception: pass
        path = self.root / tenant / f'{key}.json'
        try:
            value = json.loads(path.read_text())
            if value['expires'] > time.time(): return value['data']
        except (OSError, ValueError, KeyError): pass
        return None
    def set(self, tenant, key, value, ttl=3600):
        if self.redis:
            try:
                self.redis.setex(f'forma:{tenant}:{key}', ttl, json.dumps(value))
                return
            except Exception: pass
        directory = self.root / tenant
        directory.mkdir(parents=True, exist_ok=True)
        temp = directory / f'{uuid.uuid4()}.tmp'
        temp.write_text(json.dumps(dict(expires=time.time()+ttl, data=value)))
        temp.replace(directory / f'{key}.json')
    def delete(self, tenant, key):
        if self.redis:
            try: self.redis.delete(f'forma:{tenant}:{key}')
            except Exception: pass
        (self.root / tenant / f'{key}.json').unlink(missing_ok=True)
