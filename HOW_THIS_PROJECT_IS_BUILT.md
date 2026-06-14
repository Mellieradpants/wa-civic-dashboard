# How This Project Is Built

This repository is built with a deliberate human-in-the-loop AI workflow. The point of
writing it down is simple: an AI-assisted project earns trust only if you can see that a
human stayed in the loop and stayed grounded the whole way through. The output alone
doesn’t prove that. The process does. So here is the process, honestly.

## The roles

- **Human (decision-maker).** I decide what happens. I diagnose before anything is
  touched, I approve every change before it lands, and I own the result — what ships,
  what breaks, what gets fixed. The AI is an instrument; the artifact is the authority.
- **Analyst AI (outside view).** Explains reasoning, drafts constrained prompts, pushes
  back when I’m about to do something wrong. Its most important job is disagreeing with
  me, not agreeing.
- **Coding agent (inside view).** Works inside the codebase. Reads, traces, and — only
  after I approve a diff — commits.

## The rules, and why each one exists

- **Diagnose before touching anything.** No fix before the cause is understood. Fixing a
  symptom you haven’t traced just moves the bug.
- **Trace, don’t cut wires.** Before removing anything, confirm what depends on it. If
  removing it would break something downstream, follow the wire to its source and fix it
  there. A “clean” deletion that breaks a far-away thing is damage with a tidy commit
  message.
- **One ask at a time, explicit scope.** Each agent prompt is constrained: read-only or
  write, one task, raw output. This keeps changes small enough to actually verify.
- **Diff before commit. Nothing merges unverified.** I read the diff first, every time.
  “It probably works” is not “it works.” A passing syntax check is not a passing run.
- **Verify on a flat baseline.** Make one change at a time against a stable system, so
  when something shifts you know exactly what caused it.
- **Separate teardown from rebuild.** Rip out the old thing completely before building
  the new one. Doing both at once means you can’t tell which phase a problem came from.
- **Write down what you can’t fix now.** When something breaks that’s expected to break,
  log it and keep going. Chasing every fire means never finishing the demolition.
- **Confirm before destructive operations.** Always.

## What groundedness looks like in the history

This repo is fully public, by design, including the parts that aren’t flattering. The
commit history shows wrong turns and how they were caught: structure that was wired wrong
and torn out rather than patched, a test that passed on broken output until the blind spot
was found, fixes that sat open until they were actually verified instead of assumed. Those
are left visible on purpose. A workflow that only shows its wins looks like fog. A workflow
that shows where it drifted and how the human caught it is the part you can actually trust.

## The throughline

Depth before breadth. Get one thing genuinely correct and verifiable, then expand — and
collaborate outward with people whose strengths differ from yours. The AI accelerates the
work; it does not get to decide. The human stays the one holding the trigger, and stays
awake the whole time.
