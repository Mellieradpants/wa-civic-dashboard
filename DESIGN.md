DESIGN.md

What This Is

This document explains why the system is built the way it is. Not the technical details — those live elsewhere. This is the reasoning behind the decisions. It exists so that future builders, human or AI, understand what must remain true as the system grows.

Core Goal

This project is not just translating legislation into plain language. It is designing an information system that remains understandable and trustworthy when users are operating under uncertainty, stress, or limited cognitive bandwidth.

The objective is not to persuade, emotionally activate, or maximize engagement. The objective is to help users orient themselves quickly and accurately while preserving fidelity to the source material.

Who This Is Built For

This system is built for the person who can't afford a lawyer, can't parse dense legal language, and doesn't have time to figure out whether a bill affects them before they need to act.

That means assuming users may arrive under time pressure, stressed or worried, uncertain whether they are personally affected, unfamiliar with legal or bureaucratic language, with limited capacity to process ambiguity.

The system should not require users to perform unnecessary interpretation before understanding whether information is relevant to them.

Information Ordering

Users encountering high-stakes civic information are implicitly asking a sequence of questions. The interface should answer these in approximately this order:

	1.	Am I affected?
	2.	What changed?
	3.	Do I need to do anything?
	4.	When does this happen or apply?
	5.	Where did this information come from?
	6.	How do I know this is accurate?

What the System Is Allowed to Do

Present observable facts. Present explicitly stated relationships. Present verifiable procedural information. Present source-anchored summaries. Label uncertainty clearly.

What the System Is Not Allowed to Do

Attribute intent. Assign emotional meaning. Infer hidden motives. Construct narrative beyond the source. Fill gaps with assumptions. Fabricate certainty.

If information cannot be directly grounded in source text, the system must either expose the limitation, preserve the ambiguity, or omit the unsupported claim. It must never silently invent or complete missing meaning.

How Trust Is Built

Trust is not created by making the system sound confident. Trust is created by reducing unnecessary ambiguity while exposing uncertainty honestly.

The interface should make it easy to distinguish what is known, what is directly sourced, what has changed, what the system could not determine, and where the user can independently verify the information.

The Extraction Framework

Legislative information is structured around the 5W1H framework used throughout this project. What — what action, requirement, or change exists. Who — which people, agencies, or entities are affected. When — what dates, deadlines, or triggering conditions apply. Where — which jurisdiction, program, or context applies. Why — what explicit purpose or rationale is stated in the source, do not infer unstated motives. How — what mechanism, process, or implementation pathway exists.

The Meaning Lineage Schema

"Present source-anchored summaries" is a principle. This is its technical shape — what gets recorded so any sentence in the output can be traced back to the exact span of source text it came from, and through which steps it passed to get there.

The lineage is a tree, not a general graph — every record has exactly one parent. The tree begins the moment sec.text exists — the cleaned, section-split text produced by wa-bill-text.js, the same text scoreC4 already treats as ground truth. Nothing earlier than that has a position in the tree; what happens before sec.text exists is recorded separately, in the pre-source log below.

Record

There is one record type, not a node/edge split — every snapshot of text already is the outcome of the step that produced it, so there's no need for a second object to describe that outcome. Each record holds:

	1.	id — unique within its section's chain. IDs are assigned per-section, in pipeline step order — deterministic, not random, since the pipeline is single-threaded and this makes two runs on the same bill text reproducibly comparable later.
	2.	parentNodeId — the record that produced this one. The root record (sec.text itself) has parentNodeId: null.
	3.	text — the text itself, exactly as it exists at this point.
	4.	producedBy — the step that produced this snapshot (for example, L4 LNS, the amendment-header strip, or a sentence split).
	5.	position — a character [start, end] range into sec.text. Not into raw HTML, not into any intermediate string. sec.text, the same text scoreC4 treats as ground truth.
	6.	rule — the specific rule or pattern the step checked (for example OBLIGATION_RE, the "is amended to read as follows" header strip, the subsection-marker pattern).
	7.	matched — whether that rule matched and produced a change, or was checked and did not apply.

The root record in any section's chain is sec.text itself: position [0, sec.text.length], producedBy the section split in wa-bill-text.js, parentNodeId: null.

A step that runs and finds nothing to act on still produces a record. The rule was checked, it did not match, and that is recorded explicitly — it is not the same as the step never having run, and the schema does not collapse the two.

A record referenced as parentNodeId by more than one other record is a branch point — this is what makes "a node can have more than one edge out" concrete and checkable, rather than just a description of intent. Sentence splitting is the only current example: one record goes in — the section text after the header and subsection-marker strips — and one record comes out per resulting sentence, each pointing back at that same parentNodeId and positioned at that sentence's [start, end] range within sec.text.

Forward note, not a build requirement: this schema assumes a tree — one parent per record. If a future step ever needs to merge multiple records into one (for example, combining clauses into a single unit at ISC assembly), that assumption breaks and the identity model will need revisiting then — not now.

Pre-Source Log

Two deletions happen in wa-bill-text.js before sec.text exists: struck-text markup (the (( )) WA legislative markup for struck and substituted text) and structural breaks (the paragraph and row boundary tags — <br>, </p>, </div>, </tr> — collapsed into a single newline). Neither has a position in sec.text, because sec.text does not exist yet when either happens. Recording them as full records would imply a position they don't have.

Instead, each is one entry in a separate, small log, not part of the main tree. Each entry holds:

	1.	type — struck_text or structural_break.
	2.	removed — the text or marker that was removed.
	3.	location — where it was found, described relative to the raw document (for example, a raw-HTML offset, or "row boundary before section 3"). Never a sec.text range.

The pre-source log exists so this information is not silently lost. It is just not claiming a position in sec.text that it cannot have.

Where This Came From

This framework was mapped from direct experience as the kind of person this system serves — working class, a parent, a community college student, someone who has had to navigate government information under pressure and found the existing tools inadequate.

That is why the system is built this way. And that is what must be preserved as it grows.
