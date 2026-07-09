import { MqttService, MqttClientLike } from '../../../src/services/mqtt/mqtt.service';

function fakeClient() {
  const handlers: { message: Array<(t: string, p: Buffer) => void>; connect: Array<() => void> } = {
    message: [], connect: [],
  };
  const published: Array<{ topic: string; message: string }> = [];
  const subscribed: string[] = [];
  const client: MqttClientLike = {
    publish: (topic: string, message: string) => { published.push({ topic, message }); },
    subscribe: (topic: string) => { subscribed.push(topic); },
    on: ((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'message') handlers.message.push(cb as (t: string, p: Buffer) => void);
      if (event === 'connect') handlers.connect.push(cb as () => void);
    }) as MqttClientLike['on'],
    end: () => {},
  };
  return { client, handlers, published, subscribed };
}

describe('MqttService', () => {
  it('forwards decoded messages to listeners', () => {
    const { client, handlers } = fakeClient();
    const svc = new MqttService(client);
    const received: Array<{ topic: string; payload: string }> = [];
    svc.onMessage((topic: string, payload: string) => received.push({ topic, payload }));
    const triggerMessage = handlers.message[0];
    if (!triggerMessage) throw new Error('No message handler registered');
    triggerMessage('/p/monitor/status', Buffer.from('{"type":"success"}'));
    expect(received).toEqual([{ topic: '/p/monitor/status', payload: '{"type":"success"}' }]);
  });

  it('publishes and subscribes through the client', () => {
    const { client, published, subscribed } = fakeClient();
    const svc = new MqttService(client);
    svc.publish('/p/command/switch:0', 'on');
    svc.subscribe('/p/monitor/#');
    expect(published).toEqual([{ topic: '/p/command/switch:0', message: 'on' }]);
    expect(subscribed).toEqual(['/p/monitor/#']);
  });
});
