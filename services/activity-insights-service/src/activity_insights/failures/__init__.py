"""Processing failure records for events that could not be projected.

The documented poison/dead-letter path (docs/ARCHITECTURE.md "Failure /
poison policy"): a non-retryable or retry-budget-exhausted event is
recorded here (for operator investigation) and then acknowledged -
never retried forever, and never silently dropped either.
"""

from .repository import ProcessingFailuresRepository

__all__ = ["ProcessingFailuresRepository"]
