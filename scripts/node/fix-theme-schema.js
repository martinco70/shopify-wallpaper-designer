#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) fatal('Usage: node fix-theme-schema.js <path-to-main-product.liquid>');

if (!fs.existsSync(filePath)) fatal('File not found: ' + filePath);

const src = fs.readFileSync(filePath, 'utf8');
const startTag = '{% schema %}';
const endTag = '{% endschema %}';
const startIdx = src.indexOf(startTag);
const endIdx = src.indexOf(endTag);
if (startIdx < 0 || endIdx <= startIdx) fatal('Schema tags not found in file.');

const prefix = src.slice(0, startIdx + startTag.length);
const suffix = src.slice(endIdx);
const jsonRaw = src.slice(startIdx + startTag.length, endIdx);
const jsonStr = jsonRaw.trim();

let schema;
let working = jsonStr;
// Pre-cleanup: remove broken, double-quoted injected block if present inside arrays
// Pattern targets occurrences like ,{ ""type"": ""variant_guard"", ... } before a closing ]
const injectedBlockPattern = /,\s*\{\s*""type""\s*:\s*""variant_guard""[\s\S]*?\}\s*(?=\])/g;
if (injectedBlockPattern.test(working)) {
  working = working.replace(injectedBlockPattern, '');
}
// Also collapse any doubled quotes to single quotes ("" -> ") that may have leaked
if (working.includes('""')) {
  working = working.replace(/""/g, '"');
}

try {
  schema = JSON.parse(working);
} catch (e) {
  // Dump the JSON to a file next to this script for debugging
  const dumpPath = path.join(__dirname, 'fix-theme-schema.error.json');
  fs.writeFileSync(dumpPath, working);
  fatal('Invalid JSON inside schema before fix: ' + e.message + '\nDumped to: ' + dumpPath);
}

if (!Array.isArray(schema.blocks)) schema.blocks = [];
const hasGuard = schema.blocks.some(b => b && b.type === 'variant_guard');
if (!hasGuard) {
  schema.blocks.push({ type: 'variant_guard', name: 'Varianten-Filter', limit: 1, settings: [] });
}

const jsonOut = JSON.stringify(schema, null, 2);
const out = prefix + "\n" + jsonOut + "\n" + suffix;
fs.writeFileSync(filePath, out);
console.log('Schema repaired:', filePath);
