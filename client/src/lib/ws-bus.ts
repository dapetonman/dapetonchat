type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();

export function onWsMessage(type: string, handler: Handler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(handler);
  return () => {
    handlers.get(type)?.delete(handler);
  };
}

export function dispatchWsMessage(data: any) {
  handlers.get(data.type)?.forEach((h) => h(data));
}

let _ws: WebSocket | null = null;

export function setActiveWs(ws: WebSocket | null) {
  _ws = ws;
}

export function sendWs(msg: object) {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(msg));
  }
}
