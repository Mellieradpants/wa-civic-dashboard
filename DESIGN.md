# Washington Civic Dashboard parser

The bill reader uses the six-layer source-anchored architecture. The normal entry point is GET /api/wa-bill-text, which retrieves the official bill document and returns the result in `analysis`. Both the summary and section view use that result. The response also includes the existing cleaned sections for the source display. The browser requests view=reader for a compact response. The full response carries the evidence and all finding statuses. The standalone POST /api/plain-meaning endpoint accepts `documents` and routes them to the same parser. Its separate `units` input remains available for external TCS callers.

## Handoffs

| Layer | Input and output |
|---|---|
| Input | Capture the original decoded UTF-8 payload, its format, identifier, version, URL and intake status. Validate JSON and XML syntax and report HTML parser errors. The source remains available on rejection. |
| Structure | Index source blocks in order. Each node has an ID, parent or path, and a locator. Text, HTML and XML locators are half-open UTF-16 offsets into the captured document. JSON locators are JSON Pointers. Duplicate keys are reported as an index failure. |
| Selection | Emit selected IDs and position/content-filter reasons. The default selects nonempty content nodes and skips the Washington end marker. No legal-force rule gates selection. |
| Meaning | Create source-anchored descriptions, amendment instructions, authority records and references. Align identifiable versions on the cited RCW target and outline slot or an explicit alignment. The six comparisons receive the same aligned material and each can run on its own. Findings carry status, version identities, source locations, and cause links. Descriptions retain source wording with limited modal normalization. |
| Origin | Record fetched URL/domain and available document title, canonical URL, metadata and JSON-LD observations. Keep conflicting observed values and distribution tags distinct. |
| Verification routing | Return an assertion, locator, domain, jurisdiction, expected record system, lookup route and status. The layer does not adjudicate the assertion. |

## Versions and references

For a bill with one explicit prior session-law citation, the adapter matches that citation in the official RCW history and tries the corresponding official HTML session law. Explicit `beforeUrl` and repeated `contextUrl` parameters can supply official Washington documents. Automatic lookup can be disabled with `retrieve=false`. The default can resolve up to three directly cited RCW bases in the current document. Failed retrieval is visible in `analysis.lookups`.

For an offline or explicit comparison, send `documents` with `id`, `format`, `source`, and `version` per document, plus `beforeId` and `afterId`. Use `lenses` to run a subset. Use `alignment` to supply known pairs of provision IDs. Unpaired or unresolvable provisions produce insufficient-context findings. An amendment instruction can still be described without a matching baseline.

Authority records preserve the holder, passage, power, explicit basis and source locator. References separate the instrument from the target and retain origin-relative scope, function, status and linked references. A change in a citation can be reported from the two documents even when the meaning of the new basis is unresolved.

## Boundaries

Extraction and alignment are conservative and pattern-based. The parser does not automatically align arbitrary relocated or restated language, chase arbitrary citation chains on the network, or infer that missing text ended a duty. An available chain can be traversed through the referenced locations and reference IDs. Ambiguous and missing comparisons remain insufficient context. Source locators for HTML evidence can span the entire original markup block when words are interrupted by tags.

## Regression testing

Run `npm test`. The acceptance suite uses the HTTP handlers that serve the dashboard and replays saved official responses for HB 1111, 2024 session law chapter 118, HB 2108 and RCW 13.40.200. Any unrecorded fetch fails. The suite also exercises missing context, individual lenses, source locators, determinism, authority links, and format validation.
