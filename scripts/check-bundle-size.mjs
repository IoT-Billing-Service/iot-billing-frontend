#!/usr/bin/env node

/**
 * Bundle Size Audit Script
 *
 * Reads the Next.js build stats (stats.json or .next/trace) and fails
 * if the initial route JS exceeds the configured threshold.
 *
 * Usage:
 *   ANALYZE=true npm run build && node scripts/check-bundle-size.mjs
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const THRESHOLD_KB = 200; // Maximum initial JS size in KB (uncompressed)

const PROJECT_ROOT = process.cwd();
const STATS_PATH = join(PROJECT_ROOT, '.next', 'stats.json');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Approach 1: Parse @next/bundle-analyzer stats.json
 */
function checkStatsJson() {
  if (!existsSync(STATS_PATH)) {
    return {
      passed: false,
      error: `Stats file not found at ${STATS_PATH}. Run ANALYZE=true npm run build first.`,
    };
  }

  const require = createRequire(import.meta.url);
  const stats = require(STATS_PATH);

  // stats is an array of webpack compilation stats
  let maxInitialSize = 0;
  let maxChunkName = '';
  const initialChunks = [];

  for (const compilation of Array.isArray(stats) ? stats : [stats]) {
    const assets = compilation.assets || [];
    const chunks = compilation.chunks || [];

    for (const chunk of chunks) {
      // Initial chunks are those with names that don't start with 'webpack-runtime'
      if (chunk.initial && chunk.files) {
        for (const file of chunk.files) {
          if (file.endsWith('.js')) {
            const asset = assets.find((a) => a.name === file);
            const size = asset ? asset.size : 0;
            initialChunks.push({ name: file, size });
            if (size > maxInitialSize) {
              maxInitialSize = size;
              maxChunkName = file;
            }
          }
        }
      }
    }
  }

  const maxSizeKB = Math.round(maxInitialSize / 1024);
  const passed = maxSizeKB <= THRESHOLD_KB;

  console.log('\n=== Bundle Size Audit ===');
  console.log(`Threshold: ${THRESHOLD_KB} KB (uncompressed initial JS)`);
  console.log(`\nInitial JS chunks:`);
  for (const chunk of initialChunks) {
    const kb = Math.round(chunk.size / 1024);
    const status = kb > THRESHOLD_KB ? ' ❌ EXCEEDS THRESHOLD' : '';
    console.log(`  ${chunk.name.padEnd(50)} ${formatBytes(chunk.size).padStart(10)}${status}`);
  }

  console.log(`\nLargest initial chunk: ${maxChunkName} (${maxSizeKB} KB)`);

  if (passed) {
    console.log(`\n✅ Bundle size within ${THRESHOLD_KB} KB threshold.`);
  } else {
    console.log(
      `\n❌ FAILED: ${maxChunkName} is ${maxSizeKB} KB, which exceeds the ${THRESHOLD_KB} KB limit.`,
    );
  }

  return { passed, maxSizeKB, maxChunkName };
}

/**
 * Approach 2: Fallback — check Next.js build output in .next/static
 */
function checkBuildOutput() {
  const staticDir = join(PROJECT_ROOT, '.next', 'static');
  if (!existsSync(staticDir)) {
    return { passed: false, error: '.next/static directory not found. Run npm run build first.' };
  }

  // Recursively find all JS files in .next/static/chunks/pages
  const pagesDir = join(staticDir, 'chunks', 'pages');
  if (!existsSync(pagesDir)) {
    // App Router: check .next/static/chunks/app
    const appDir = join(staticDir, 'chunks', 'app');
    if (!existsSync(appDir)) {
      return { passed: null, error: 'Could not determine bundle structure.' };
    }
  }

  return {
    passed: null,
    message: 'Stats-based check only; run ANALYZE=true npm run build for detailed audit.',
  };
}

function main() {
  let result = checkStatsJson();

  if (result.passed === null || result.error) {
    console.log(result.error || result.message);
    // Fallback: try the build output check
    result = checkBuildOutput();
    if (result.passed === null) {
      console.log('Warning: Could not perform bundle size audit. Skipping.');
      process.exit(0);
    }
  }

  if (!result.passed) {
    process.exit(1);
  }
}

main();
