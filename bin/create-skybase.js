#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const readline = require('readline')

const TEMPLATE_ROOT = path.join(__dirname, '..')

// Directories/files to never copy into the new project
const EXCLUDE = new Set([
  '.git',
  'node_modules',
  'bin',
  'pnpm-lock.yaml',
  'package-lock.json'
])

// File extensions treated as text (eligible for {{d.proName}} replacement)
const TEXT_EXTS = new Set([
  '.js', '.json', '.md', '.yml', '.yaml',
  '.html', '.css', '.txt', '.sh', '.env',
  '.tpl', '.lua', '.properties',
])

function isText (filePath) {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase())
}

/**
 * Copy template files into destDir, replacing {{d.proName}} with projectName.
 * Two-pass: non-tpl files first, then .tpl files (so .tpl always wins).
 */
function copyDir (srcDir, destDir, projectName) {
  fs.mkdirSync(destDir, { recursive: true })

  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  const tplEntries = []

  // Pass 1: non-.tpl files
  for (const entry of entries) {
    if (EXCLUDE.has(entry.name)) continue
    if (entry.name.endsWith('.tpl')) {
      tplEntries.push(entry)
      continue
    }

    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, projectName)
    } else {
      copyFile(srcPath, destPath, projectName)
    }
  }

  // Pass 2: .tpl files (strip extension, overwrite if conflict)
  for (const entry of tplEntries) {
    const baseName = entry.name.slice(0, -4) // strip ".tpl"
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, baseName)
    copyFile(srcPath, destPath, projectName)
  }
}

function copyFile (srcPath, destPath, projectName) {
  if (isText(srcPath)) {
    let content = fs.readFileSync(srcPath, 'utf8')
    content = content.replace(/\{\{d\.proName\}\}/g, projectName)
    fs.writeFileSync(destPath, content, 'utf8')
  } else {
    fs.copyFileSync(srcPath, destPath)
  }
}

function prompt (question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main () {
  console.log('\n=== create-skybase ===\n')

  let projectName = process.argv[2]

  if (!projectName) {
    projectName = await prompt('Project name: ')
  }

  if (!projectName) {
    console.error('Error: project name is required')
    process.exit(1)
  }

  if (!/^[a-z0-9][a-z0-9\-_]*$/.test(projectName)) {
    console.error('Error: project name must start with a lowercase letter or digit, and contain only lowercase letters, digits, hyphens, or underscores')
    process.exit(1)
  }

  const targetDir = path.join(process.cwd(), projectName)

  if (fs.existsSync(targetDir)) {
    console.error(`Error: directory "${projectName}" already exists`)
    process.exit(1)
  }

  console.log(`Project: ${projectName}`)
  console.log(`Target:  ${targetDir}\n`)

  // Copy template files
  copyDir(TEMPLATE_ROOT, targetDir, projectName)

  // Update package.json name and version
  const pkgPath = path.join(targetDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.name = projectName
    pkg.version = '0.1.0'
    // Remove scaffold-specific fields that don't belong in a generated project
    delete pkg.bin
    delete pkg.files
    delete pkg.repository
    delete pkg.bugs
    delete pkg.homepage
    delete pkg.keywords
    delete pkg.author
    delete pkg.license
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }

  console.log('✓ Files generated')

  // Install dependencies
  console.log('\nRunning npm install...\n')
  try {
    execSync('npm install', { cwd: targetDir, stdio: 'inherit' })
    console.log('\n✓ Dependencies installed')
  } catch (e) {
    console.warn(`\n⚠ npm install failed. Run manually:\n  cd ${projectName} && npm install`)
  }

  console.log(`
Done! Get started:

  cd ${projectName}
  node index.js       # basic example

Example endpoints (after start):
  http://127.0.0.1:13000/skyapi/mock/first
  http://127.0.0.1:13000/skyapi/probe/mysql
`)
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
