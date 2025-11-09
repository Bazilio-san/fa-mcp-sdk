import * as dotenv from 'dotenv';
import { getConsulAPI } from './get-consul-api.js';

dotenv.config();

getConsulAPI().then(({ deregister }) => {
  const [, , svcId, agentHost, agentPort] = process.argv;
  deregister(svcId, agentHost, agentPort).then(() => null);
});
