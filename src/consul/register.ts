import { getConsulAPI } from './get-consul-api.js';

export const registerCyclic = async () => {
  const api = await getConsulAPI();
  return api.register.cyclic;
};
