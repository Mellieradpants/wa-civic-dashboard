import { parse } from "parse5";
import { SaxesParser } from "saxes";

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const FORMATS = new Set(["text", "html", "json", "xml"]);
export function captureInput({ id, source, format, encoding = "utf-8", mediaType = null, url = null, instrument = null, version = null }) {
  const input = { id, source, format, encoding, mediaType, url, instrument, version, status: "accepted", issues: [] };
  const reject = (status, message) => Object.assign(input, { status, issues: [message] });

  if (typeof source !== "string") return reject("malformed", "Expected a decoded source string.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) return reject("too_large", "Document exceeds the 4 MiB decoded-input limit.");
  if (!FORMATS.has(format) || !/^utf-8$/i.test(encoding)) {
    return reject("unsupported", "Input must be UTF-8 text, HTML, XML, or JSON.");
  }
  try {
    if (format === "json") JSON.parse(source);
    if (format === "xml") {
      const parser = new SaxesParser({ xmlns: true });
      parser.on("doctype", () => { throw new Error("XML document type declarations are unsupported."); });
      parser.write(source).close();
    }
    if (format === "html") {
      input.issues = htmlErrors(source);
      if (input.issues.length) input.status = "malformed";
    }
  } catch (error) {
    reject("malformed", error.message);
  }
  return input;
}

function htmlErrors(source) {
  const issues = [];
  parse(source, {
    scriptingEnabled: false,
    onParseError(error) {
      if (error.code !== "missing-doctype") issues.push(error.code + " at offset " + error.startOffset);
    },
  });
  return issues;
}
