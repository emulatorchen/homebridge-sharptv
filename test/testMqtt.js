'use strict';

const rewire = require('rewire');
const { expect } = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');

// ─── Shared mocks ──────────────────────────────────────────────────────────────

function makeMqttClient() {
  const c = new EventEmitter();
  c.publish   = sinon.stub();
  c.subscribe = sinon.stub();
  c.end       = sinon.stub();
  return c;
}

// Minimal net mock — only needed so sendCommand doesn't open real sockets
const silentSocket = () => ({
  setTimeout: sinon.stub(), connect: sinon.stub(),
  on: sinon.stub(), write: sinon.stub(),
  end: sinon.stub(), destroy: sinon.stub()
});

const mockHomebridge = {
  hap: {
    Service: {
      AccessoryInformation: class { setCharacteristic() { return this; } },
      Switch: class { getCharacteristic() { return { onSet() { return this; }, onGet() { return this; } }; } }
    },
    Characteristic: { Manufacturer: 'M', Model: 'Mo', SerialNumber: 'S', On: 'On' }
  },
  registerAccessory: sinon.stub()
};

const baseConfig = {
  name: 'Living Room TV',
  username: 'admin',
  password: 'pass',
  on: 'POWR1   ',
  off: 'POWR0   ',
  state: 'POWR????',
  on_value: '1',
  exact_match: false,
  host: '192.168.1.100',
  port: 10002
};

const mqttConfig = {
  ...baseConfig,
  mqtt_broker: 'mqtt://localhost:21883',
  mqtt_topic: 'home/living-room/tv/sharp'
};

const TOPIC = 'home/living-room/tv/sharp';

function setup() {
  const loader = rewire('../index.js');
  const client = makeMqttClient();
  const mockMqtt = { connect: sinon.stub().returns(client) };
  loader.__set__('mqtt', mockMqtt);
  loader.__set__('net', { Socket: sinon.stub().returns(silentSocket()) });
  const SharpTVAccessory = loader(mockHomebridge);
  return { loader, client, mockMqtt, SharpTVAccessory };
}

// ─── Connection ────────────────────────────────────────────────────────────────

describe('MQTT — connection', () => {
  it('calls mqtt.connect with the configured broker URL', () => {
    const { mockMqtt, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    expect(mockMqtt.connect.calledOnce).to.be.true;
    expect(mockMqtt.connect.firstCall.args[0]).to.equal('mqtt://localhost:21883');
  });

  it('configures LWT on the availability topic with offline payload and retain:true', () => {
    const { mockMqtt, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    const opts = mockMqtt.connect.firstCall.args[1];
    expect(opts.will.topic).to.equal(`${TOPIC}/availability`);
    expect(opts.will.retain).to.be.true;
    const payload = JSON.parse(opts.will.payload);
    expect(payload.value).to.equal('offline');
    expect(payload).to.have.property('ts');
  });

  it('subscribes to {topic}/set on connect', () => {
    const { client, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    client.emit('connect');
    expect(client.subscribe.calledWith(`${TOPIC}/set`)).to.be.true;
  });

  it('publishes online availability on connect', () => {
    const { client, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    client.emit('connect');
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/availability`);
    expect(call).to.exist;
    const payload = JSON.parse(call.args[1]);
    expect(payload.value).to.equal('online');
    expect(payload).to.have.property('ts');
  });

  it('publishes online availability on reconnect', () => {
    const { client, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    client.emit('reconnect');
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/availability`);
    expect(call).to.exist;
    expect(JSON.parse(call.args[1]).value).to.equal('online');
  });

  it('does not throw on MQTT error', () => {
    const { client, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    expect(() => client.emit('error', new Error('connection refused'))).to.not.throw();
  });

  it('passes mqtt_username and mqtt_password to connect options', () => {
    const { mockMqtt, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), { ...mqttConfig, mqtt_username: 'u', mqtt_password: 'p' });
    const opts = mockMqtt.connect.firstCall.args[1];
    expect(opts.username).to.equal('u');
    expect(opts.password).to.equal('p');
  });

  it('does not log the broker URL', () => {
    const { client, SharpTVAccessory } = setup();
    const log = sinon.stub();
    new SharpTVAccessory(log, mqttConfig);
    client.emit('connect');
    client.emit('error', new Error('test'));
    const logged = log.args.flat().join('\n');
    expect(logged).to.not.include('mqtt://localhost:21883');
  });
});

// ─── /set subscription ─────────────────────────────────────────────────────────

describe('MQTT — /set subscription', () => {
  let client, tv;

  beforeEach(() => {
    const { SharpTVAccessory, client: c } = setup();
    client = c;
    tv = new SharpTVAccessory(sinon.stub(), mqttConfig);
    sinon.stub(tv, 'setState');
  });

  function send(payload) {
    client.emit('message', `${TOPIC}/set`, Buffer.from(payload));
  }

  it('calls setState(true) on {"value":"ON"}',  () => { send('{"value":"ON"}');  expect(tv.setState.calledWith(true)).to.be.true;  });
  it('calls setState(false) on {"value":"OFF"}', () => { send('{"value":"OFF"}'); expect(tv.setState.calledWith(false)).to.be.true; });

  it('ignores malformed JSON',              () => { send('not-json');         expect(tv.setState.called).to.be.false; });
  it('ignores empty string payload',        () => { send('');                 expect(tv.setState.called).to.be.false; });
  it('ignores empty object',                () => { send('{}');               expect(tv.setState.called).to.be.false; });
  it('ignores missing value field',         () => { send('{"brightness":5}'); expect(tv.setState.called).to.be.false; });
  it('ignores numeric value type',          () => { send('{"value":1}');      expect(tv.setState.called).to.be.false; });
  it('ignores unknown string value',        () => { send('{"value":"MAYBE"}');expect(tv.setState.called).to.be.false; });
  it('ignores null JSON value',             () => { send('{"value":null}');   expect(tv.setState.called).to.be.false; });
  it('does not throw on null-like payload', () => {
    expect(() => send('null')).to.not.throw();
    expect(tv.setState.called).to.be.false;
  });
});

// ─── State publish after setState ──────────────────────────────────────────────

describe('MQTT — state publish after setState', () => {
  let client, tv;

  beforeEach(() => {
    const { SharpTVAccessory, client: c } = setup();
    client = c;
    tv = new SharpTVAccessory(sinon.stub(), mqttConfig);
    sinon.stub(tv, 'sendCommand').resolves(true);
  });

  it('publishes {"value":"ON"} to state topic after setState(true)', async () => {
    await tv.setState(true);
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/state`);
    expect(call).to.exist;
    const payload = JSON.parse(call.args[1]);
    expect(payload.value).to.equal('ON');
    expect(payload).to.have.property('ts');
  });

  it('publishes {"value":"OFF"} to state topic after setState(false)', async () => {
    await tv.setState(false);
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/state`);
    expect(call).to.exist;
    expect(JSON.parse(call.args[1]).value).to.equal('OFF');
  });
});

// ─── State publish after getState ──────────────────────────────────────────────

describe('MQTT — state publish after getState', () => {
  it('publishes {"value":"ON"} when TV is on', async () => {
    const { client, SharpTVAccessory } = setup();
    const tv = new SharpTVAccessory(sinon.stub(), mqttConfig);
    sinon.stub(tv, 'sendCommand').resolves(true);
    await tv.getState();
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/state`);
    expect(call).to.exist;
    expect(JSON.parse(call.args[1]).value).to.equal('ON');
  });

  it('publishes {"value":"OFF"} when TV is off', async () => {
    const { client, SharpTVAccessory } = setup();
    const tv = new SharpTVAccessory(sinon.stub(), mqttConfig);
    sinon.stub(tv, 'sendCommand').resolves(false);
    await tv.getState();
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/state`);
    expect(call).to.exist;
    expect(JSON.parse(call.args[1]).value).to.equal('OFF');
  });
});

// ─── Availability payload format ───────────────────────────────────────────────

describe('MQTT — availability payload format', () => {
  it('online payload has value and ts fields', () => {
    const { client, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    client.emit('connect');
    const call = client.publish.getCalls().find(c => c.args[0] === `${TOPIC}/availability`);
    const payload = JSON.parse(call.args[1]);
    expect(payload).to.have.all.keys('value', 'ts');
    expect(payload.value).to.equal('online');
    expect(payload.ts).to.be.a('number');
  });

  it('LWT offline payload has value and ts fields', () => {
    const { mockMqtt, SharpTVAccessory } = setup();
    new SharpTVAccessory(sinon.stub(), mqttConfig);
    const will = mockMqtt.connect.firstCall.args[1].will;
    const payload = JSON.parse(will.payload);
    expect(payload).to.have.all.keys('value', 'ts');
    expect(payload.value).to.equal('offline');
    expect(payload.ts).to.be.a('number');
  });
});
