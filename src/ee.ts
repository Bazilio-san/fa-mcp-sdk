import EventEmitter from 'node:events';

export const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(12);
