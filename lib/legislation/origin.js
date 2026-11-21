export function readOrigin(input) {
  const values = new Map();
  const distribution = [];
  const add = (field, value, signal, locator = null) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!values.has(field)) values.set(field, []);
    values.get(field).push({ value: value.trim(), signal, locator });
  };
  if (input.url) {
    try { add("site", new URL(input.url).hostname, "fetched_url"); } catch { /* unparseable observed URL */ }
    add("sourceUrl", input.url, "adapter");
  }
  add("contentType", input.mediaType || input.format, "adapter");
  const source = typeof input.source === "string" ? input.source : "";
  const locator = match => ({ documentId: input.id, start: match.index, end: match.index + match[0].length });
  if (input.format === "html") {
    for (const match of source.matchAll(/<!--\s*field:\s*CaptionsTitles\s*-->([\s\S]*?)<!--\s*field:\s*-->/gi)) {
      add("title", match[1].replace(/<[^>]*>/g, ""), "legislative_caption", locator(match));
    }
    for (const match of source.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)) add("title", match[1], "html_title", locator(match));
    for (const match of source.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
      const attrs = Object.fromEntries([...match[0].matchAll(/\b([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(part => [part[1].toLowerCase(), part[2] ?? part[3] ?? part[4]]));
      if (attrs.rel?.toLowerCase() === "canonical") add("canonicalUrl", attrs.href, "canonical_link", locator(match));
      const name = (attrs.property || attrs.name || "").toLowerCase();
      if (/^(?:og|twitter):/.test(name) && attrs.content) distribution.push({ name, value: attrs.content, locator: locator(match) });
      const field = { author: "author", publisher: "publisher", date: "publicationTime", "article:published_time": "publicationTime" }[name];
      if (field) add(field, attrs.content, "html_meta:" + name, locator(match));
    }
    for (const match of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(match[1]);
        for (const node of [].concat(data["@graph"] || data)) {
          add("title", node.headline || node.name, "json_ld", locator(match));
          for (const author of [].concat(node.author || [])) add("author", author?.name || author, "json_ld", locator(match));
          add("publisher", node.publisher?.name || node.publisher, "json_ld", locator(match));
          add("publicationTime", node.datePublished, "json_ld", locator(match));
          for (const type of [].concat(node["@type"] || [])) add("schemaType", type, "json_ld", locator(match));
        }
      } catch { /* malformed provenance hints supply no observed fields */ }
    }
  }
  if (input.format === "json" && input.status === "accepted") {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, field] of Object.entries({
        title: "title", headline: "title", author: "author", publisher: "publisher",
        datePublished: "publicationTime", publicationTime: "publicationTime", account: "account",
      })) {
        const values = [].concat(parsed[key] ?? []);
        for (const [index, value] of values.entries()) {
          const path = "/" + key + (Array.isArray(parsed[key]) ? "/" + index : "");
          const named = value && typeof value === "object";
          add(field, named ? value.name : value, "json_metadata",
            { documentId: input.id, pointer: path + (named ? "/name" : "") });
        }
      }
    }
  }
  if (input.format === "xml" && input.status === "accepted") {
    const fields = { title: "title", author: "author", publisher: "publisher", datepublished: "publicationTime", publicationtime: "publicationTime", account: "account" };
    for (const match of source.matchAll(/<(title|author|publisher|datePublished|publicationTime|account)\b[^>]*>([^<]*)<\/\1>/gi)) {
      add(fields[match[1].toLowerCase()], match[2], "xml_element", locator(match));
    }
  }
  const fields = {};
  for (const name of ["site", "sourceUrl", "canonicalUrl", "title", "author", "publisher", "publicationTime", "contentType", "schemaType", "account"]) {
    const observations = values.get(name) || [];
    fields[name] = {
      state: !observations.length ? "missing" : new Set(observations.map(item => item.value)).size > 1 ? "conflicting" : "observed",
      observations,
    };
  }
  return { documentId: input.id, fields, distribution };
}
