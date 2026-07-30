import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import standaloneCode from 'ajv/dist/standalone/index.js'

const validators = [
  ['problemAnalysis.schema.json', 'problemAnalysisValidator.js'],
  ['solution.schema.json', 'solutionValidator.js'],
]

for (const [schemaName, outputName] of validators) {
  const schemaUrl = new URL(`../src/ai/${schemaName}`, import.meta.url)
  const outputUrl = new URL(`../src/ai/generated/${outputName}`, import.meta.url)
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
  const ajv = new Ajv({
    allErrors: true,
    code: { esm: true, source: true },
    strict: false,
  })
  const validate = ajv.compile(schema)
  const source = standaloneCode(ajv, validate).replace(
    /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/u,
    'const $1 = (value) => Array.from(value).length;',
  )
  if (source.includes('require(')) {
    throw new Error(`${outputName} still contains CommonJS runtime imports`)
  }
  await writeFile(
    fileURLToPath(outputUrl),
    `/* oxlint-disable */\n${source}`,
  )
}
