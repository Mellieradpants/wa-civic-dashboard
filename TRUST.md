TRUST.md

This system renders Washington State legislation into plain English. It does that by following a strict set of rules — no guessing, no filling in gaps, no generating text that can't be traced back to the original bill.

But sometimes it can't complete that process. Here's exactly what happens when it can't, and why that's part of how it earns trust.

What the system will never do

It will never show you plain language output that can't be traced back to the source text. It will never fill in missing content. It will never guess at what a section means. It will never leave you with a dead end.

What happens when something breaks

There are three ways this system can hit a wall. In every case, the response is the same — here is the official source. Go there.

If it can't reach the bill at all, it tells you and links you to the official Washington State legislative record.

If it can reach the bill but can't parse it into sections, it tells you and links you to the original document it was streaming from.

If it can parse the bill but can't confidently match the output back to the source, it doesn't show the output. It tells you the section couldn't be rendered and links you to the original.

The system couldn't parse this section. Please refer to the original document.

That's the message. Simple, honest, with a path forward.

Why this matters

A system that hides failure isn't trustworthy. A system that shows you exactly where it stopped, and hands you back the source, is doing what any honest translator does when they hit a word they can't render — they mark it, not skip it.

You always know where you stand. You always have somewhere to go.

Why these constraints exist

Some of the behaviors described here may appear conservative. They are intentional. The purpose of this system is not to maximize the amount of plain language output it can produce. The purpose is to ensure that every rendered statement remains connected to the legislative record and that users can always distinguish between what the system knows and what it cannot determine.

Future changes should preserve these principles, even if alternative implementations appear more convenient or produce more complete output.

Trace meaning, not text. Preserve meaning, not style. Optimize for accuracy before efficiency.

The renderer should never change wording for the sake of variety, flow, or avoiding repetition. If a transformation makes text read better but can't be traced word-for-word back to who the source text says is responsible for what, it's wrong — even if it looks cleaner. Repeated wording is acceptable. Lost or altered meaning is not.
