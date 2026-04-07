import '../bootstrap/dotenv.js';
import { isMainModule, isNonEmptyObject } from '../utils/utils.js';

import { getConsulAPI } from './get-consul-api.js';


export const deregisterServiceFromConsul = async () => {
  const [, , svcId, agentHost, agentPort] = process.argv;

  if (!svcId) {
    throw new Error('Service ID (svcId) is required');
  }
  let options: any = { host: agentHost, port: agentPort };
  if (!isNonEmptyObject(options)) {
    options = undefined;
  }
  try {
    const { deregister } = await getConsulAPI();
    await deregister(svcId, options);
  } catch (err) {
    console.error(err);
  }
};

if (isMainModule(import.meta.url)) {
  deregisterServiceFromConsul().then(() => 0);
}
