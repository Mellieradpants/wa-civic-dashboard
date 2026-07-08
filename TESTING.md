TESTING.md

What Testing Is For

Every test in this system is asking one question: what changed, and did it change the right way?

New bills come in. The legislature updates formatting. Dependencies shift. Testing is how we make sure none of that silently breaks what people are relying on.

How We Think About Testing

Every check answers one or more of these questions. What changed. Why did it change. When did it change. How did it change. Who does it affect. Where in the pipeline did the change occur.

The goal is not just a passing build. The goal is a system whose behavior can be observed, explained, and reproduced.

The Three Layers

Layer 1 — Correctness. Is this output from the official source? Did anything get added that wasn't there? Every plain language sentence must trace back to the original bill text. No AI fill-in. No guessing. No content that doesn't exist in the source. What we check: did the system produce output, does every sentence's anchor text appear as a literal match somewhere in the original bill text, are there any artifacts that signal something went wrong. What failure means: a sentence appeared whose anchor text cannot be found in the source, or the output is empty with no explanation.

Layer 2 — Change Detection. When a new bill comes in or something upstream changes, does the pipeline handle it without breaking what was already working? What we check: does the same bill produce the same output every time it runs, when a new bill comes in does it process without breaking existing bills, are there duplicate sentences or output drift that wasn't there before. What failure means: something changed upstream and the pipeline didn't accommodate it cleanly.

Layer 3 — Trustworthiness. When the system can't parse something, does it always give you a path back to the source? The Washington State legislative record is always available. If this system can't render a section, it must always connect you there. A dead end is never acceptable. What we check: when parsing fails does the user see a clear message, does the failure link back to the official Washington State source, is the failure recorded so maintainers can find and fix it. What failure means: a user hit a wall with no way forward. That breaks the core promise of this system.

How to Run the Tests

node scripts/test-bills.js

The script runs against a random sample of bills plus a set of sentinel bills — specific bills flagged as important test cases because they cover known edge cases the pipeline needs to handle correctly. Results are written to data/wa/test-results.json after every run.

How to Read the Results

Each bill gets a PASS or a list of failures. Each failure includes the exact reason — what check failed and where in the output it occurred. When something fails, the first question is always: what changed?

Sentinel Bills

Sentinel bills are specific bills we always test, every run, because they cover edge cases the pipeline must handle correctly. They are not random. Some are chosen because a single bill is individually hard to parse. Others are chosen because they represent a whole structural category that behaves differently — for example, procedural chamber resolutions (HR/SR), which lack the Sec. N. structure most bills have. To add a sentinel bill, add its bill number to data/wa/test-bills.json under the sentinels array, along with a knownIssues entry explaining why its expected result differs from a normal bill.

Test History

Every run is appended to data/wa/test-results.json. That file is the record. It does not get overwritten — it grows over time so patterns of failure are visible across runs.

The cumulative stats in data/wa/test-results.json include a testedBillNumbers array — the real, sorted list of every distinct bill number tested so far, not just a count. This can be checked directly against data/wa/bill-index.json to confirm coverage and catch any bill that's been skipped.

The Ongoing Commitment

Every new bill is a new test. This system does not get tested once at launch and left alone. The legislature keeps producing legislation and the pipeline has to keep up. When something breaks, the record shows what broke, when, and why. That is the accountability layer. It exists so that the people relying on this system can know it is being watched.
