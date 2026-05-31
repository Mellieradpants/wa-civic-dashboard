function buildSpec(baseUrl) {
  return {
    openapi: "3.1.0",
    info: {
      title: "WA Civic Dashboard API",
      version: "1.0.0",
      description:
        "Plain-language access to Washington State legislation. All endpoints are fully deterministic — no external AI API calls. Bill metadata, plain-meaning extraction, and multi-language rendering all run on the server without any LLM dependency.",
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
            "Keyword or bill-number search against the local bill index, with optional AI query expansion. Bill-number queries also perform a live official lookup.",
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
            "Fetches the official HTML bill document, strips markup, and splits the result into sections.",
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
          operationId: "getBillSelection",
          summary: "Extract rule candidate units from bill text",
          description:
            "Classifies sentences from the bill text into signal types (obligation, prohibition, permission, condition, exception, definition, reference) and groups them into rule candidate units.",
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
              description: "Selected meaning units",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BillSelectionResponse" },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
          },
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
            "Runs text through the 10-layer parsing pipeline (5WIH → SSE → CFS → LNS → AAC → TPS → SJM → MPS → RDS → ISC) then applies scope-lens sentence templates to produce plain-meaning output. No AI calls. Accepts raw text or pre-processed ISC units from the TCS pipeline.",
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
                  schema: { $ref: "#/components/schemas/PlainMeaningResponse" },
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
              description: "Plain-language translation",
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
            session: { type: "string", example: "2025-26" },
            status: { type: "string" },
            summary: { type: "string" },
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
            billNumber: { type: "string" },
            biennium: { type: "string" },
            textCharacterCount: { type: "integer" },
            sectionCount: { type: "integer" },
            sections: { type: "array", items: { $ref: "#/components/schemas/BillSection" } },
          },
        },
        BillSelectionResponse: {
          type: "object",
          properties: {
            billNumber: { type: "string" },
            biennium: { type: "string" },
            sectionCount: { type: "integer" },
            selectionSummary: { type: "object" },
            selectedUnits: { type: "array", items: { type: "object" } },
            ruleUnits: { type: "array", items: { type: "object" } },
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
        PlainMeaningRequest: {
          type: "object",
          properties: {
            language: {
              type: "string",
              enum: ["en", "es", "vi", "ru", "uk", "tl", "so", "ko"],
              description: "Output language for rendered sentences. Defaults to en. Uses static templates — no AI.",
            },
          },
          oneOf: [
            {
              required: ["text"],
              properties: {
                text: {
                  type: "string",
                  maxLength: 50000,
                  description: "Raw bill or policy text. The full 10-layer pipeline runs on this input.",
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
              },
            },
            parse: {
              type: "object",
              properties: {
                who: {
                  type: "object",
                  properties: {
                    responsibleParty: { type: "string", nullable: true },
                    actors: { type: "array", items: { type: "string" } },
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
          },
        },
        PlainMeaningResponse: {
          type: "object",
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
        TranslateRequest: {
          type: "object",
          required: ["text", "language"],
          properties: {
            text: { type: "string", description: "Plain-language summary text to translate." },
            language: {
              type: "string",
              enum: ["es", "vi", "ru", "uk", "tl", "so", "ko"],
              description: "Target language code (SHB 2475 priority order): es=Spanish, vi=Vietnamese, ru=Russian, uk=Ukrainian, tl=Tagalog, so=Somali, ko=Korean.",
            },
            billNumber: { type: "string" },
            biennium: { type: "string" },
          },
        },
        TranslateResponse: {
          type: "object",
          properties: {
            translatedText: { type: "string" },
            language: { type: "string" },
            cached: { type: "boolean" },
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
            translation: { type: "string", description: "Plain-language paragraph." },
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

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost";
  const baseUrl = `${proto}://${host}`;

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json(buildSpec(baseUrl));
}
