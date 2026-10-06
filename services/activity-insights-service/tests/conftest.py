"""Test-only env defaults.

The application itself never hardcodes a MongoDB URI - db.py requires
MONGODB_URI/MONGODB_DB_NAME to come from the environment. This file
exists solely so pytest can import and exercise the app (including its
FastAPI lifespan) without a real .env file, the same way
test/setup-env.ts does for the Nest service. The host below does not
need to be reachable - no test here asserts a real database operation
succeeds, only that failure is handled correctly.
"""

import os

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017")
os.environ.setdefault("MONGODB_DB_NAME", "insights_db")
