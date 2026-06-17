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

Where This Came From

This framework was mapped from direct experience as the kind of person this system serves — working class, a parent, a community college student, someone who has had to navigate government information under pressure and found the existing tools inadequate.

That is why the system is built this way. And that is what must be preserved as it grows.
