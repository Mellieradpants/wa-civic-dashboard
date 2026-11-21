# Washington parser acceptance

Run `npm ci` and `npm test`. The suite replays the HTTP responses listed in `data/wa/parser-fixtures/manifest.json`. The HTML files are saved Washington Legislature responses. Tests make no live requests.

- **HB 1111 and 2024 session law chapter 118, section 4.** Check the proposed change from 20 years of total confinement to reaching age 24, the linked eligibility finding, the continuing permission to petition, and preservation of the bill's expiration.
- **HB 2108 and RCW 13.40.200.** Check the court's power to impose sanctions, the exact source block, the external enabling reference, the distinction from an amendment target, and the restored bias-limiting duty.
- **Scope and confidence.** Test missing version and cited context, duty effects linked to their cause, retained authority chains, individual-lens equivalence, determinism, source locations, provenance conflicts and supported formats.

The previous per-bill C1/C4/C5/C6/L1 score files are historical results. The new suite asserts provision-level behavior, including legal force, supporting context and exact source locations. Its checks do not measure corpus-wide accuracy.
