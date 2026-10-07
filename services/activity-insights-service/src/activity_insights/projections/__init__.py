"""Activity and workload projections built from consumed domain events.

- `state.py`: per-work-item current state, version-gated against
  older/out-of-order events (item_state collection, internal).
- `workload.py`: counters by project/column/priority/assignee, derived
  from state transitions (workload_projection collection).
- `activity.py`: append-only per-project activity timeline
  (activity_projection collection).
"""

from .activity import ActivityProjectionRepository
from .state import ItemEventKind, ItemEventOutcome, ItemStateRepository
from .workload import WorkloadProjectionRepository

__all__ = [
    "ActivityProjectionRepository",
    "ItemEventKind",
    "ItemEventOutcome",
    "ItemStateRepository",
    "WorkloadProjectionRepository",
]
