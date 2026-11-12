// Compiles contracts/Escrow.cash -> contracts/Escrow.json (CashScript artifact).
// Run with: npm run compile
import { compileFile } from 'cashc';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = compileFile(join(root, 'contracts', 'Escrow.cash'));
writeFileSync(join(root, 'contracts', 'Escrow.json'), JSON.stringify(artifact, null, 2));
console.log(`Compiled ${artifact.contractName} -> contracts/Escrow.json`);
console.log(`Bytecode: ${artifact.bytecode.length / 2} bytes, functions: ${artifact.abi.map((f) => f.name).join(', ')}`);
