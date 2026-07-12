"""Import the complete Product Reset model graph into SQLAlchemy metadata."""

from app.db.models.catalog import Rubric
from app.db.models.corrections import CorrectionPackage, CorrectionPart
from app.db.models.external_approval import ExternalApprovalCycle
from app.db.models.identity import User, UserFunction
from app.db.models.notifications import Notification
from app.db.models.production import StoryProductionState
from app.db.models.scenario import (
    Scenario,
    ScenarioEditSession,
    ScenarioReadMarker,
    ScenarioRevision,
    ScenarioRevisionRow,
    ScenarioRow,
)
from app.db.models.stories import Story, StoryAssignment, StoryEvent, StoryMaterialLink
from app.db.models.workflow import StoryWorkflowState

__all__ = [
    "CorrectionPackage",
    "CorrectionPart",
    "ExternalApprovalCycle",
    "Notification",
    "Rubric",
    "Scenario",
    "ScenarioEditSession",
    "ScenarioReadMarker",
    "ScenarioRevision",
    "ScenarioRevisionRow",
    "ScenarioRow",
    "Story",
    "StoryAssignment",
    "StoryEvent",
    "StoryMaterialLink",
    "StoryProductionState",
    "StoryWorkflowState",
    "User",
    "UserFunction",
]
