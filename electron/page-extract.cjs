// Inert HTML parser: no scripts, remote assets, browser session or credentials.
const { parse } = require("parse5");
const SKIP = new Set(["script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "input", "textarea", "select"]);
const attr = (node, key) => (node.attrs || []).find((a) => a.name === key)?.value;
const hidden = (node) => (node.attrs || []).some((a) => a.name === "hidden" || (a.name === "aria-hidden" && a.value === "true"));
function nodeText(node) {
  if (SKIP.has(node.tagName) || hidden(node)) return "";
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(nodeText).join(" ");
}

function extractPage(page) {
  if (page.contentType.startsWith("text/plain")) return { title: "", text: page.body.replace(/\s+/g, " ").trim().slice(0, 12000), links: [], tableRows: [] };
  const root = parse(page.body);
  const text = [], links = [], tables = [];
  let title = "";
  const visit = (node, inTitle = false) => {
    const tag = node.tagName || "";
    if (SKIP.has(tag) || hidden(node)) return;
    if (node.nodeName === "#text") {
      const value = (node.value || "").replace(/\s+/g, " ").trim();
      if (value) { if (inTitle) title = (title + " " + value).trim(); else text.push(value); }
      return;
    }
    if (tag === "a" && links.length < 30) {
      try {
        const url = new URL(attr(node, "href") || "", page.url);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
          const label = nodeText(node).replace(/\s+/g, " ").trim().slice(0, 160);
          if (label) links.push({ label, url: url.toString() });
        }
      } catch { /* malformed link */ }
    }
    if (tag === "tr" && tables.length < 20) {
      const cells = (node.childNodes || []).filter((child) => ["td", "th"].includes(child.tagName)).slice(0, 8)
        .map((child) => nodeText(child).replace(/\s+/g, " ").trim().slice(0, 300));
      if (cells.length) tables.push(cells);
    }
    for (const child of node.childNodes || []) visit(child, inTitle || tag === "title");
  };
  visit(root);
  return { title: title.slice(0, 300), text: text.join(" ").slice(0, 12000), links, tableRows: tables };
}
module.exports = { extractPage };
