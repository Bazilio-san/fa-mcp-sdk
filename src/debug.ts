import { Debug } from 'af-tools-ts';
import { bold, reset, yellow } from 'af-color';


export const debugTokenAuth = Debug('token:auth', {
  noTime: false,
  noPrefix: false,
  prefixColor: bold + yellow,
  messageColor: reset,
});

// agent
// config-info
// dialog-metrics-collector
// fetch
// log-event
// pipeline
// query-builder
// queue:testing
// rag
// report
// rest-api
// sql
// sql:count
// testing
// token:auth
// user
// web:all
// web:headers
// web:health

// ntlm:auth-flow
// ntlm:ldap-proxy
// ntlm:ldap-proxy-id
// ntlm:context
