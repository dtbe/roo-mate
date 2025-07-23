# Standardised Documentation and Protocols

## 1. Standardised Subtask Creation Protocol
All subtasks delegated between modes must follow this standardised format to ensure clarity and accountability.

```markdown
[TITLE]

## Context
[BACKGROUND_INFORMATION_AND_RELATIONSHIP_TO_LARGER_PROJECT]

## Scope
[SPECIFIC_REQUIREMENTS_AND_BOUNDARIES]
[STEP_BY_STEP_INSTRUCTIONS_WHEN_APPROPRIATE]

## Expected Output
[DETAILED_DESCRIPTION_OF_DELIVERABLES]
[FORMAT_SPECIFICATIONS]
[QUALITY_CRITERIA]
```

## 2. File Structure Standards
The project maintains a standardised directory structure for all process and rule documentation.

```
/Home/
├── .roo/                          # Process documentation
│   ├── rules/                     # Global rules
│   ├── rules-{mode}/              # Mode-specific rules
│   └── logs/                      # Activity logs
│
└── [project-specific directories as needed]
```

## 3. Mode Delegation Matrix
When a task falls outside a mode's core capabilities, it must be escalated to the appropriate specialist.

```yaml
collaboration_escalation:
  strategy: >
    Use delegated tasks to cooperate across modes. Escalate
    out-of-scope work to the correct specialist.
  examples:
    - schema changes → architect
    - runtime/test issues → debug
    - unclear user intent → ask
    - implementation needs → code
    - task coordination → orchestrator
