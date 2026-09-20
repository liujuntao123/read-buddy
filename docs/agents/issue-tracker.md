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
