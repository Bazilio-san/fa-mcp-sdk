import '../../bootstrap/dotenv.js';
import chalk from 'chalk';
import { ChildProcess } from 'child_process';
import { BaseMcpClient } from './BaseMcpClient.js';

const SHOW_IN = process.env.TEST_SHOW_IN === 'true';
const SHOW_OUT = process.env.TEST_SHOW_OUT === 'true';
const SHOW_ERR = process.env.TEST_SHOW_ERR === 'true';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  t: NodeJS.Timeout;
}

export class McpStdioClient extends BaseMcpClient {
  private proc: ChildProcess;
  private pending: Map<number, PendingRequest>;
  private buffer: string;

  constructor (proc: ChildProcess) {
    super({});
    this.proc = proc;
    this.pending = new Map();
    this.buffer = '';

    if (this.proc.stdout) {
      this.proc.stdout.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        this.processLines();
      });
    }
    if (this.proc.stderr) {
      this.proc.stderr.on('data', (data: Buffer) => {
        if (SHOW_ERR) {
          console.error(chalk.gray(String(data)));
        }
      });
    }
  }

  processLines () {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s) {
        continue;
      }
      try {
        const msg = JSON.parse(s);
        if (SHOW_IN) {
          console.log(chalk.bgYellow('IN ') + s);
        }
        if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error)) {
          const p = this.pending.get(msg.id);
          if (p) {
            clearTimeout(p.t);
            this.pending.delete(msg.id);
            if (msg.error) {
              p.reject(new Error(msg.error?.message || 'MCP Error'));
            } else {
              p.resolve(msg.result);
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  send (method: string, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    const text = JSON.stringify(req) + '\n';
    if (SHOW_OUT) {
      console.log(chalk.bgBlue('OUT') + ' ' + text.trim());
    }
    if (this.proc.stdin) {
      this.proc.stdin.write(text);
    } else {
      throw new Error('Process stdin is not available');
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, t });
    });
  }

  // Override sendRequest to use the existing send method
  protected override async sendRequest (method: string, params: any): Promise<any> {
    return this.send(method, params);
  }
}
