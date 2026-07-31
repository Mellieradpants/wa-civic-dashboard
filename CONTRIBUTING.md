# Contributing

This is a student project and it is open to review. If you work in legislative drafting, computational linguistics, law, or software, and you would like to look at the code, the parsing rules, or the process, contributions and corrections are welcome. Open an issue or a pull request.

## The most useful contribution

Corrections to output are the most useful contribution, and they do not require reading the codebase. If you find a bill where the plain-language rendering is wrong or missing, open an issue with:

- the bill number and section
- what the output says
- what the official bill text says
- what the output should say

Hand-checking bills against their source text is the only way meaning errors are found. Automated checks in this repository verify that output is well-formed and traceable to source; they do not verify that the meaning is correct.

## If you are contributing code

- Every fix needs a real bill sentence proving the problem occurs. Invented examples are not used as test cases.
- Test fixtures are verbatim source text, quoted exactly.
- One defect per pull request. Fixes are not batched.
- Changes go on a branch and are merged by pull request. Nothing is pushed directly to main.
