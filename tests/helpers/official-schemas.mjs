import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import assert from 'node:assert/strict';

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
addFormats(ajv);
const read = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/mcp-2026-07-28/${name}.schema.json`, import.meta.url)));
const core = read('core');
const tasks = read('tasks');
ajv.addSchema(core, 'core');
ajv.addSchema(tasks, 'tasks');
export function assertSchema(name, value, source = 'tasks') {
  const schema = source === 'tasks' ? tasks : core;
  const defs = schema.$defs ? '$defs' : 'definitions';
  const validate = ajv.getSchema(`${source}#/${defs}/${name}`);
  assert.ok(validate, `Missing official schema ${name}`);
  assert.ok(validate(value), JSON.stringify(validate.errors));
}
