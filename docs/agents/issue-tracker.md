# Issue Tracker: Local Markdown

Issues for this repo are tracked as Markdown files under `.scratch/`.

## Layout

Each feature or workstream has a folder under `.scratch/issues/<feature>/`:

```
.scratch/
└── issues/
    └── <feature>/
        ├── 001-issue-title.md
        └── 002-another-issue.md
```

## Issue file format

Each issue file contains YAML frontmatter and Markdown body:

```markdown
---
id: "001"
title: "Issue title"
status: "open" # open | in-progress | closed
blocked_by: [] # list of issue IDs that must finish before this can start
labels: ["ready-for-agent"]
---

### Problem

[Description of what needs to be solved]

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

## Planning rules

### Landed base

A spec premised on an external codebase ("基于 X") carries a ticket that lands that base in this repo, and every dependent ticket lists it in `blocked_by`. Write that ticket before any dependent ticket starts. When implementation substitutes a stub for the base, open a debt ticket in the same commit (see ADR 0009 for the failure this rule prevents).

### Real-data acceptance

Every feature spec carries at least one end-to-end acceptance criterion driven by real input — a real file through the import entry, a real render on screen — phrased so an in-repo fixture satisfies it only by flowing through that public entry. Service-seam criteria alone close a ticket without closing the feature.
