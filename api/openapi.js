function buildSpec(baseUrl) {
  return {
    openapi: "3.1.0",
    info: {
      title: "WA Civic Dashboard API",
      version: "1.0.0",
      description:
        "Plain-language access to Washington State legislation. All endpoints are fully deterministic — no external AI API calls. Bill metadata and plain-meaning extraction run on the server without any LLM dependency.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/health": {
        get: {
          operationId: "getHealth",
          summary: "Service health check",
          description: "Checks WA Legislature API reachability and bill index load status. No external AI dependency.",
          responses: {
            200: {
              description: "Health status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/api/wa-bill-search": {
        get: {
          operationId: "searchBills",
          summary: "Search Washington State bills",
          description:
            "Keyword or bill-number search against the local bill index. Bill-number queries also perform a live official lookup against the WA Legislature API. Query expansion uses RCW title synonym mapping — no AI.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              description: "Search query — keyword phrase or bill number (e.g. 1234 or HB 1234)",
              schema: { type: "string" },
            },
            {
              name: "session",
              in: "query",
              required: false,
              description: "Biennium filter (e.g. 2025-26, 2025, or 2026). Defaults to current biennium.",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Search results",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BillSearchResponse" },
                },
              },
            },
          },
        },
      },
      "/api/wa-bill-detail": {
        get: {
          operationId: "getBillDetail",
          summary: "Fetch official bill metadata",
          description:
            "Retrieves title, sponsor, status, and fiscal flags from the Washington State Legislature SOAP API.",
          parameters: [
            {
              name: "billNumber",
              in: "query",
              required: true,
              description: "Numeric bill number (e.g. 1234). Also accepts bill or q.",
              schema: { type: "string" },
            },
            {
              name: "biennium",
              in: "query",
              required: false,
              description: "Biennium (e.g. 2025-26). Defaults to current biennium.",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Bill detail",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BillDetailResponse" },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/wa-bill-documents": {
        get: {
          operationId: "getBillDocuments",
          summary: "List official bill documents",
          description:
            "Scrapes the WA Legislature document search page and returns links to PDFs, HTML, and Word documents for a bill.",
          parameters: [
            {
              name: "billNumber",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "biennium",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Document list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BillDocumentsResponse" },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
          },
        },
      },
      "/api/wa-bill-text": {
        get: {
          operationId: "getBillText",
          summary: "Extract bill text and sections",
          description:
            "Fetches official bill text, captures the source and returns sections and source-anchored analysis.",
          parameters: [
            {
              name: "billNumber",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "biennium",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            ...["documentUrl", "beforeUrl", "retrieve", "view"].map(name => ({ name, in: "query", schema: { type: "string" } })),
            { name: "contextUrl", in: "query", schema: { type: "array", items: { type: "string", format: "uri" } } },
          ],
          responses: {
            200: {
              description: "Extracted bill text",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BillTextResponse" },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
          },
        },
      },
      "/api/wa-bill-selection": {
        get: {
          operationId: "getBillSelection", deprecated: true,
          summary: "Retired; use the selection in the bill-text analysis",
          responses: { 410: { description: "Selection is returned by GET /api/wa-bill-text." } },
        },
      },
      "/api/wa-bill-plain-summary": {
        get: {
          operationId: "getBillPlainSummary",
          summary: "Plain-language bill summary (deprecated)",
          description:
            "Removed. Returns 410 Gone. Use /api/plain-meaning instead.",
          parameters: [
            {
              name: "billNumber",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "biennium",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Plain-language summary",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PlainSummaryResponse" },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            500: { $ref: "#/components/responses/ServerError" },
          },
        },
      },
      "/api/plain-meaning": {
        post: {
          operationId: "generatePlainMeaning",
          summary: "Generate plain-language sentences (deterministic, no AI)",
          description:
            "Analyzes captured documents or plain text, or renders preprocessed ISC units for legacy callers.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlainMeaningRequest" },
                examples: {
                  rawText: {
                    summary: "Raw text input",
                    value: {
                      text: "The department shall submit a written report to the Board of Directors within thirty days of each audit completion.",
                    },
                  },
                  iscUnits: {
                    summary: "Pre-processed ISC units",
                    value: {
                      units: [
                        {
                          tetherAnchor: {
                            sourceLocation: "sentence_1",
                            anchorText: "The department shall submit a report within thirty days.",
                            matchedSignals: ["obligation"],
                          },
                          parse: {
                            who: { responsibleParty: "The department", actors: ["The department"], modal: "shall" },
                            what: { claim: "The department shall submit a report within thirty days.", action: "submit a report", conditions: [] },
                            when: { deadlines: ["within thirty days"], triggers: [], sequence: [] },
                            how: { mechanism: null, enforcement: null },
                            where: { jurisdiction: null, system: null, controllingEntity: null },
                          },
                          missingSignals: ["missing_enforcement"],
                          status: "incomplete",
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Plain-meaning output",
              content: {
                "application/json": {
                  schema: { oneOf: [{ $ref: "#/components/schemas/SourceAnchoredAnalysis" }, { $ref: "#/components/schemas/PlainMeaningResponse" }] },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            500: { $ref: "#/components/responses/ServerError" },
          },
        },
      },
      "/api/analyze": {
        post: {
          operationId: "analyzeSection",
          summary: "Section analysis (deprecated)",
          description:
            "Removed. Returns 410 Gone. Use /api/plain-meaning instead.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AnalyzeRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Plain-language summary",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AnalyzeResponse" },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            500: { $ref: "#/components/responses/ServerError" },
          },
        },
      },
      "/api/openapi": {
        get: {
          operationId: "getOpenApiSpec",
          summary: "OpenAPI 3.1 specification",
          description: "Returns this specification document.",
          responses: {
            200: {
              description: "OpenAPI spec",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "degraded", "error"] },
            serviceUrl: { type: "string" },
            plainMeaningEndpoint: { type: "string" },
            checks: { type: "object" },
          },
        },
        BillRecord: {
          type: "object",
          properties: {
            bill_id_display: { type: "string", example: "HB 1234" },
            bill_number: { type: "string", example: "1234" },
            abbreviation: { type: "string", example: "HB" },
            record_type: { type: "string", example: "House Bill" },
            chamber: { type: "string", example: "House" },
            title: { type: "string" },
            legal_title: { type: "string", nullable: true, description: "Full legal title from WA Legislature XML API." },
            session: { type: "string", example: "2025-26" },
            status: { type: "string" },
            summary: { type: "string" },
            sponsor: { type: "string", nullable: true, description: "Primary sponsor name from bill index." },
            introducedDate: { type: "string", nullable: true, description: "ISO date string of introduction." },
            historyLine: { type: "string", nullable: true, description: "Most recent action history line." },
            committee: { type: "string", nullable: true, description: "Current committee or location abbreviation." },
            source_url: { type: "string", format: "uri" },
            detail_api_path: { type: "string" },
          },
        },
        BillSearchResponse: {
          type: "object",
          properties: {
            query: { type: "string" },
            biennium: { type: "string" },
            searchMode: { type: "string" },
            rcwExpansion: { type: "array", items: { type: "string" } },
            results: { type: "array", items: { $ref: "#/components/schemas/BillRecord" } },
          },
        },
        BillDetailResponse: {
          type: "object",
          properties: {
            billNumber: { type: "string" },
            biennium: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            sponsor: { type: "string" },
            introducedDate: { type: "string" },
            status: { type: "string" },
            currentStatus: { type: "object" },
            fiscalFlags: { type: "object" },
            source_url: { type: "string", format: "uri" },
          },
        },
        BillDocument: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            url: { type: "string", format: "uri" },
            file_type: { type: "string", enum: ["pdf", "html", "word", "document"] },
          },
        },
        BillDocumentsResponse: {
          type: "object",
          properties: {
            billNumber: { type: "string" },
            biennium: { type: "string" },
            status: { type: "string", enum: ["found", "not_found"] },
            originalBill: { $ref: "#/components/schemas/BillDocument" },
            documents: { type: "array", items: { $ref: "#/components/schemas/BillDocument" } },
          },
        },
        BillSection: {
          type: "object",
          properties: {
            id: { type: "string" },
            sectionNumber: { type: "string" },
            isNewSection: { type: "boolean" },
            text: { type: "string" },
            characterCount: { type: "integer" },
          },
        },
        BillTextResponse: {
          type: "object",
          properties: {
            analysis: { oneOf: [{ $ref: "#/components/schemas/SourceAnchoredAnalysis" }, { $ref: "#/components/schemas/ReaderAnalysis" }] },
            billNumber: { type: "string" },
            biennium: { type: "string" },
            textCharacterCount: { type: "integer" },
            sectionCount: { type: "integer" },
            sections: { type: "array", items: { $ref: "#/components/schemas/BillSection" } },
          },
        },
        ReaderAnalysis: {
          type: "object",
          required: ["architecture", "documents", "meaning", "plainMeaning", "lookups"],
          not: { required: ["origin"] },
          properties: {
            architecture: { const: "source-anchored-v1" },
            documents: { type: "array", items: { type: "object" } },
            meaning: { type: "object" },
            plainMeaning: { type: "string" },
            sectionTypes: { type: "array", items: { type: "object" } },
            lookups: { type: "array", items: { type: "object" } },
          },
        },
        PlainSummaryResponse: {
          type: "object",
          properties: {
            billNumber: { type: "string" },
            biennium: { type: "string" },
            summary: { type: "string", description: "3–5 sentence plain-language summary." },
            cached: { type: "boolean" },
          },
        },
        SourceDocumentInput: {
          type: "object",
          required: ["id", "format", "source"],
          properties: {
            id: { type: "string" },
            format: { type: "string", enum: ["text", "html", "xml", "json"] },
            source: { type: "string" },
            encoding: { type: "string", default: "utf-8" },
            mediaType: { type: "string" },
            url: { type: "string", format: "uri" },
            instrument: { type: "string" },
            version: { type: "string" },
          },
        },
        SourceAnchoredAnalysis: {
          type: "object",
          required: ["architecture", "documents", "meaning", "origin", "verification", "plainMeaning"],
          properties: {
            architecture: { const: "source-anchored-v1" },
            documents: { type: "array", items: { type: "object", required: ["input", "structure", "selection", "provisions"] } },
            meaning: { type: "object", required: ["mode", "descriptions", "lenses", "references", "authority"] },
            origin: { type: "array", items: { type: "object" } },
            verification: { type: "array", items: { type: "object" } },
            lookups: { type: "array", items: { type: "object" } },
            plainMeaning: { type: "string" },
            hasContent: { type: "boolean" },
            sectionTypes: { type: "array", items: { type: "object" } },
          },
        },
        PlainMeaningRequest: {
          type: "object",
          properties: {
            debug: {
              type: "boolean",
              description:
                "When true, each entry in sentences[] includes a debug object with the actor/modal/action/conditions/deadlines fields used to render it and the lens template applied.",
            },
          },
          oneOf: [
            {
              required: ["documents"],
              properties: {
                documents: { type: "array", minItems: 1, maxItems: 8, items: { $ref: "#/components/schemas/SourceDocumentInput" } },
                beforeId: { type: "string" }, afterId: { type: "string" },
                lenses: { type: "array", items: { type: "string", enum: ["modality_shift", "applicability_change", "allocation_of_power", "governed_action_change", "threshold_change", "duty_effect"] } },
                selectionRules: { type: "object", properties: { firstOrder: { type: "integer", minimum: 0 }, lastOrder: { type: "integer", minimum: 0 }, minimumLength: { type: "integer", minimum: 0 }, maximumLength: { type: "integer", minimum: 0 }, pathPrefix: { type: "string" }, containsLiteral: { type: "string" } }, additionalProperties: false },
                alignment: { type: "array", items: { type: "object", required: ["before", "after"], properties: { before: { type: "string" }, after: { type: "string" } } } },
              },
            },
            {
              required: ["text"],
              properties: {
                text: {
                  type: "string",
                  description: "Plain text source document. The UTF-8 intake limit is 4 MiB; server request limits may be lower."
                },
              },
            },
            {
              required: ["units"],
              properties: {
                units: {
                  type: "array",
                  description: "Pre-processed ISC units from the TCS pipeline. Skips directly to the template renderer.",
                  items: { $ref: "#/components/schemas/IscUnit" },
                },
              },
            },
          ],
        },
        IscUnit: {
          type: "object",
          properties: {
            tetherAnchor: {
              type: "object",
              properties: {
                sourceLocation: { type: "string" },
                anchorText: { type: "string" },
                matchedSignals: {
                  type: "array",
                  items: { type: "string", enum: ["obligation", "permission", "prohibition"] },
                },
                subordinateClauseSignals: {
                  type: "array",
                  description: "Optional. One entry per relative clause (which/that/who) found to carry its own modal word, separate from the main clause's. Absent or empty on units that predate this field.",
                  items: {
                    type: "object",
                    properties: {
                      marker: { type: "string", enum: ["which", "that", "who"] },
                      clauseText: { type: "string" },
                      signal: { type: "string", enum: ["obligation", "permission", "prohibition"], nullable: true },
                    },
                  },
                },
              },
            },
            parse: {
              type: "object",
              properties: {
                who: {
                  type: "object",
                  properties: {
                    responsibleParty: { type: "string", nullable: true },
                    modal: { type: "string", nullable: true },
                  },
                },
                what: {
                  type: "object",
                  properties: {
                    claim: { type: "string" },
                    action: { type: "string", nullable: true },
                    conditions: { type: "array", items: { type: "string" } },
                  },
                },
                when: {
                  type: "object",
                  properties: {
                    deadlines: { type: "array", items: { type: "string" } },
                    triggers: { type: "array", items: { type: "string" } },
                    sequence: { type: "array", items: { type: "string" } },
                  },
                },
                how: {
                  type: "object",
                  properties: {
                    mechanism: { type: "string", nullable: true },
                    enforcement: { type: "string", nullable: true },
                  },
                },
                where: {
                  type: "object",
                  properties: {
                    jurisdiction: { type: "string", nullable: true },
                    system: { type: "string", nullable: true },
                    controllingEntity: { type: "string", nullable: true },
                  },
                },
              },
            },
            missingSignals: { type: "array", items: { type: "string" } },
            status: { type: "string", enum: ["ok", "incomplete"] },
          },
        },
        PlainMeaningSentence: {
          type: "object",
          properties: {
            sourceLocation: { type: "string" },
            lens: {
              type: "string",
              enum: [
                "modality_shift",
                "actor_power_shift",
                "scope_change",
                "threshold_shift",
                "action_domain_shift",
                "obligation_removal",
              ],
            },
            signal: {
              type: "string",
              enum: ["obligation", "permission", "prohibition"],
            },
            sectionType: {
              type: "string",
              enum: ["addition", "amendment", "repeal", "delayed", "appropriation", "standard"],
              description: "Section type classified before the pipeline runs.",
            },
            sentence: { type: "string" },
            missingSignals: { type: "array", items: { type: "string" } },
            controlFlags: { type: "array", items: { type: "string" } },
            status: { type: "string", enum: ["ok", "incomplete"] },
            debug: {
              description: "Only present when the request set debug: true. The actor/modal/action/conditions/deadlines fields used by the renderer, and the lens template applied. A single object for most sentences; an array with one entry per clause when a compound sentence (e.g. 'shall X and must Y') was split and rendered as separate clauses.",
              oneOf: [
                { $ref: "#/components/schemas/PlainMeaningDebugFields" },
                {
                  type: "array",
                  items: { $ref: "#/components/schemas/PlainMeaningDebugFields" },
                },
              ],
            },
          },
        },
        PlainMeaningDebugFields: {
          type: "object",
          properties: {
            actor: { type: "string", nullable: true },
            modal: { type: "string" },
            rawModal: { type: "string" },
            action: { type: "string", nullable: true },
            conditions: { type: "array", items: { type: "string" } },
            deadlines: { type: "array", items: { type: "string" } },
            enforcement: { type: "string", nullable: true },
            templateUsed: { type: "string" },
          },
        },
        PlainMeaningResponse: {
          type: "object",
          required: ["plainMeaning", "sentences", "pipeline"],
          properties: {
            plainMeaning: {
              type: "string",
              description: "All sentences joined — the complete plain-language output.",
            },
            sentences: {
              type: "array",
              items: { $ref: "#/components/schemas/PlainMeaningSentence" },
              description: "One entry per extracted signal sentence, with lens and signal metadata.",
            },
            pipeline: {
              type: "object",
              properties: {
                inputSource: { type: "string", enum: ["raw_text", "isc_units"] },
                unitCount: { type: "integer" },
                sentenceCount: { type: "integer" },
                inputLength: { type: "integer" },
                extractedSentences: { type: "integer" },
              },
            },
          },
        },
        AnalyzeRequest: {
          type: "object",
          oneOf: [
            { required: ["content"], properties: { content: { type: "string" } } },
            { required: ["sourceUrl"], properties: { sourceUrl: { type: "string", format: "uri" } } },
          ],
        },
        AnalyzeResponse: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Plain-language paragraph." },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            message: { type: "string" },
            error: { type: "string" },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "Missing or invalid parameters",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        NotFound: {
          description: "Bill or resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        ServerError: {
          description: "Internal server error or upstream service failure",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  };
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "localhost";
  const baseUrl = `${proto}://${host}`;

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json(buildSpec(baseUrl));
}
