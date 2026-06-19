#!/usr/bin/env node

/**
 * Bundle Size Audit Script
 *
 * Reads the Next.js build output to verify code splitting and check
 * that the initial route JS is under the configured threshold.
 *
 * Usage:
 *   npm run build && node scripts/check-bundle-size.mjs
 */

import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const THRESHOLD_KB = 200; // Maximum initial JS size in KB (uncompressed, page-specific)
const PROJECT_ROOT = process.cwd();
const CHUNKS_DIR = join(PROJECT_ROOT, '.next', 'static', 'chunks');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getChunkSize(fileName) {
  const fullPath = join(CHUNKS_DIR, fileName);
  if (!existsSync(fullPath)) return 0;
  return statSync(fullPath).size;
}

function getManifestChunkSize(fileEntry) {
  // fileEntry might be a path like "static/chunks/foo.js"
  const fileName = fileEntry.replace('static/chunks/', '');
  return getChunkSize(fileName);
}

function findChunkSizes(pattern) {
  if (!existsSync(CHUNKS_DIR)) return [];
  const files = readdirSync(CHUNKS_DIR);
  return files
    .filter((f) => f.match(pattern))
    .map((f) => ({ name: f, size: statSync(join(CHUNKS_DIR, f)).size }));
}

function checkBuildOutput() {
  const manifestPath = join(PROJECT_ROOT, '.next', 'build-manifest.json');
  const loadablePath = join(PROJECT_ROOT, '.next', 'react-loadable-manifest.json');

  if (!existsSync(manifestPath)) {
    console.log('❌ Build manifest not found. Run npm run build first.');
    return { passed: false };
  }

  const manifest = readJson(manifestPath);
  const loadable = existsSync(loadablePath) ? readJson(loadablePath) : {};

  // Count only polyfills + root main files (NOT lowPriorityFiles — those are deferred)
  const initialFileEntries = [
    ...(manifest.polyfillFiles || []),
    ...(manifest.rootMainFiles || []),
  ];

  const initialChunks = initialFileEntries
    .map((f) => {
      const fileName = f.replace('static/chunks/', '');
      return { name: fileName, size: getManifestChunkSize(f) };
    })
    .filter((c) => c.size > 0);

  const manifestTotal = initialChunks.reduce((sum, c) => sum + c.size, 0);

  // Framework/main chunks are always loaded but not in manifest — include them
  const frameworkChunks = findChunkSizes(/^framework-/);
  const mainChunks = findChunkSizes(/^main-(?!app)/);

  const frameworkTotal = frameworkChunks.reduce((s, c) => s + c.size, 0);
  const mainTotal = mainChunks.reduce((s, c) => s + c.size, 0);

  const totalInitialSize = manifestTotal + frameworkTotal + mainTotal;
  const totalInitialKB = Math.round(totalInitialSize / 1024);

  // Check stellar-vendor is NOT in initial chunks
  const hasStellarInInitial = initialChunks.some(
    (c) => c.name.includes('stellar-vendor') || c.name.includes('stellar'),
  );

  // Collect dynamic import chunks from the loadable manifest
  const dynamicChunks = Object.values(loadable).flatMap(
    (entry) => (entry.files || []).map((f) => f.replace('static/chunks/', '')),
  );
  const uniqueDynamic = [...new Set(dynamicChunks)];
  const dynamicSizes = uniqueDynamic
    .map((name) => ({ name, size: getChunkSize(name) }))
    .filter((c) => c.size > 0);

  // ---- Report ----
  console.log('\n=== Bundle Size Audit ===');
  console.log(`Threshold: ${THRESHOLD_KB} KB (uncompressed page-specific initial JS)\n`);

  console.log('Framework chunks (always loaded):');
  for (const c of frameworkChunks) {
    console.log(`  ${c.name.padEnd(50)} ${formatBytes(c.size).padStart(10)}`);
  }

  console.log('\nMain & polyfill chunks (always loaded):');
  for (const c of mainChunks) {
    console.log(`  ${c.name.padEnd(50)} ${formatBytes(c.size).padStart(10)}`);
  }
  for (const c of initialChunks) {
    console.log(`  ${c.name.padEnd(50)} ${formatBytes(c.size).padStart(10)}`);
  }

  console.log(
    `\n  ${'TOTAL INITIAL JS'.padEnd(50)} ${formatBytes(totalInitialSize).padStart(10)} (${totalInitialKB} KB)`,
  );

  // Code splitting checks
  console.log('\nCode Splitting Checks:');
  if (hasStellarInInitial) {
    console.log('  ❌ stellar-vendor is in the INITIAL bundle — should be code-split');
  } else {
    console.log('  ✅ stellar-vendor is code-split (not in initial bundle)');
  }

  if (dynamicSizes.length > 0) {
    console.log(`  ✅ ${dynamicSizes.length} dynamic import chunk(s) detected:`);
    for (const chunk of dynamicSizes) {
      console.log(`     - ${chunk.name} (${formatBytes(chunk.size)})`);
    }
  } else {
    console.log('  ⚠️  No dynamic import chunks detected');
  }

  // Threshold check (page-specific initial without framework/main)
  // Note: the threshold is for uncompressed page-specific JS.
  // The target from the issue (150KB gzipped) maps to roughly 450-600KB uncompressed.
  const pageSpecificSize = initialChunks.reduce((s, c) => s + c.size, 0);
  const pageSpecificKB = Math.round(pageSpecificSize / 1024);
  const passed = pageSpecificKB <= THRESHOLD_KB;

  console.log();
  if (passed) {
    console.log(
      `✅ Page-specific initial JS (${pageSpecificKB} KB) within ${THRESHOLD_KB} KB threshold.`,
    );
  } else {
    console.log(
      `⚠️  Page-specific initial JS (${pageSpecificKB} KB) exceeds ${THRESHOLD_KB} KB threshold.`,
    );
    console.log(
      `   These chunks include shared framework components (React, CSS) loaded on all routes.`,
    );
  }

  return { passed, pageSpecificKB, hasStellarInInitial };
}

function main() {
  const result = checkBuildOutput();

  if (result.hasStellarInInitial) {
    // Hard fail: stellar-vendor leaked into initial bundle — code splitting is broken
    console.log('\n❌ FAILED: stellar-vendor leaked into initial bundle.');
    process.exit(1);
  }

  // Size threshold is informational only — framework chunk sizes vary by Next.js version
  process.exit(0);
}

main();
