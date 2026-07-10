HOW_THIS_PROJECT_IS_BUILT

Purpose

Defines the development workflow for this repository.

This is a working framework, not a finished one. It reflects current understanding and is expected to change as knowledge and perspective develop.

---

Principles

- One human serves as Decision Authority.
- Repository evidence is required for verification.
- Roles are defined by responsibility.
- Automation performs assigned work.
- AI operates within roles. It is not a role.
- Implementations may change. Responsibilities do not.

---

Roles

---

Decision Authority

Input
- Repository evidence
- Proposed changes

Responsibilities
- Define objectives
- Set priorities
- Accept or reject changes
- Authorize merges

Permissions
- Full repository access

---

Repository Analyst

Input
- Repository clone
- Objective

Responsibilities
- Analyze repository state
- Define implementation task
- Verify completed work

Permissions
- Read-only repository access

Output
- Scoped task
- Verification

---

Implementation Agent

Input
- Scoped task

Responsibilities
- Modify repository contents
- Execute commands
- Run tests
- Create branches
- Commit changes
- Open pull requests

Restrictions
- No scope expansion
- No merge authority

Output
- Diff
- Command output
- Test results

---

External Analyst

Input
- Repository snapshot
- Review question

Responsibilities
- Independent technical review

Output
- Analysis

---

Workflow

1. Define objective.
2. Scope task.
3. Implement.
4. Verify.
5. Approve or reject.

---

Constraints

- Identify the cause before implementing a change.
- All changes use branches and pull requests.
- Verification uses repository evidence.
- Recurring issues receive permanent handling.
- Documentation changes are performed independently of implementation work.
