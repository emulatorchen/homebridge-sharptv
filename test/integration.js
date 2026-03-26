'use strict';

/**
 * Integration test — requires a running Mosquitto broker.
 *
 * Configure via env vars (defaults match local_infra Mosquitto setup):
 *   MQTT_BROKER  mqtt://emulator-ubuntu.local:21883   (required — test skips if unset)
 *   MQTT_TOPIC   home/test/tv/sharp                  (optional, defaults below)
 *   MQTT_USER    mqtt username                        (optional)
 *   MQTT_PASS    mqtt password                        (optional)
 *
 * Run:
 *   MQTT_BROKER=mqtt://emulator-ubuntu.local:21883 MQTT_USER=xxx MQTT_PASS=xxx npm run integration
 */

const net    = require('net');
const mqtt   = require('mqtt');
const { expect } = require('chai');

const BROKER = process.env.MQTT_BROKER;
const TOPIC  = process.env.MQTT_TOPIC || 'home/test/tv/sharp';
const USER   = process.env.MQTT_USER;
const PASS   = process.env.MQTT_PASS;

// ─── Skip gracefully if broker not configured ──────────────────────────────────

if (!BROKER) {
  console.log('\n  [integration] MQTT_BROKER not set — skipping integration tests.');
  console.log('  Run with: MQTT_BROKER=mqtt://host:21883 MQTT_USER=x MQTT_PASS=x npm run integration\n');
  process.exit(0);
}

// ─── Minimal homebridge mock ───────────────────────────────────────────────────

const mockHomebridge = {
  hap: {
    Service: {
      AccessoryInformation: class { setCharacteristic() { return this; } },
      Switch: class { getCharacteristic() { return { onSet() { return this; }, onGet() { return this; } }; } }
    },
    Characteristic: { Manufacturer: 'M', Model: 'Mo', SerialNumber: 'S', On: 'On' }
  },
  registerAccessory: () => {}
};

const SharpTVAccessory = require('../index.js')(mockHomebridge);

// ─── Fake TV TCP server ────────────────────────────────────────────────────────

let tvServer, tvPort;

function startFakeTV() {
  return new Promise(resolve => {
    tvServer = net.createServer(socket => {
      socket.on('data', data => {
        const parts = data.toString().trim().split('\r');
        const cmd = parts[parts.length - 1].trim();
        // state query → respond with "1" (TV is on)
        // any set command → respond with "OK"
        socket.write(cmd.includes('????') ? '1\r\n' : 'OK\r\n');
        socket.end();
      });
    });
    tvServer.listen(0, '127.0.0.1', () => {
      tvPort = tvServer.address().port;
      resolve();
    });
  });
}

// ─── Test helpers ──────────────────────────────────────────────────────────────

function waitForMessage(client, filterFn, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for MQTT message')), timeoutMs);
    client.on('message', function handler(topic, msg) {
      let parsed;
      try { parsed = JSON.parse(msg.toString()); } catch (e) { return; }
      if (filterFn(topic, parsed)) {
        clearTimeout(timer);
        client.removeListener('message', handler);
        resolve({ topic, payload: parsed });
      }
    });
  });
}

function connectTestClient() {
  return new Promise((resolve, reject) => {
    const opts = USER ? { username: USER, password: PASS } : {};
    const client = mqtt.connect(BROKER, opts);
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe('Integration — MQTT + fake TV', function() {
  this.timeout(10000);

  let tv, testClient;

  before(async () => {
    await startFakeTV();
    testClient = await connectTestClient();
    await new Promise((res, rej) => testClient.subscribe(`${TOPIC}/#`, err => err ? rej(err) : res()));
  });

  after(done => {
    if (tv && tv.mqttClient) tv.mqttClient.end(true);
    if (testClient) testClient.end(true);
    if (tvServer) tvServer.close(done);
    else done();
  });

  it('connects to broker and publishes online availability', async () => {
    const available = waitForMessage(testClient,
      (t, p) => t === `${TOPIC}/availability` && p.value === 'online');

    const config = {
      name: 'Integration TV', username: 'admin', password: 'pass',
      on: 'POWR1   ', off: 'POWR0   ', state: 'POWR????',
      on_value: '1', exact_match: false,
      host: '127.0.0.1', port: tvPort,
      mqtt_broker: BROKER, mqtt_topic: TOPIC,
      mqtt_username: USER, mqtt_password: PASS
    };
    tv = new SharpTVAccessory(() => {}, config);

    const msg = await available;
    expect(msg.payload.value).to.equal('online');
    expect(msg.payload).to.have.property('ts');
  });

  it('publishes state to MQTT after getState', async () => {
    const stateMsg = waitForMessage(testClient,
      (t, p) => t === `${TOPIC}/state` && (p.value === 'ON' || p.value === 'OFF'));

    await tv.getState();

    const msg = await stateMsg;
    expect(msg.payload.value).to.equal('ON'); // fake TV always returns "1" = on
    expect(msg.payload).to.have.property('ts');
  });

  it('processes /set ON command and publishes updated state', async () => {
    const stateMsg = waitForMessage(testClient,
      (t, p) => t === `${TOPIC}/state`);

    testClient.publish(`${TOPIC}/set`, JSON.stringify({ value: 'ON' }));

    const msg = await stateMsg;
    expect(msg.payload.value).to.equal('ON');
  });

  it('processes /set OFF command and publishes updated state', async () => {
    const stateMsg = waitForMessage(testClient,
      (t, p) => t === `${TOPIC}/state`);

    testClient.publish(`${TOPIC}/set`, JSON.stringify({ value: 'OFF' }));

    const msg = await stateMsg;
    expect(msg.payload.value).to.equal('OFF');
  });

  it('ignores malformed /set and does not publish spurious state', done => {
    let received = false;
    const handler = (topic) => {
      if (topic === `${TOPIC}/state`) received = true;
    };
    testClient.on('message', handler);
    testClient.publish(`${TOPIC}/set`, 'not-json');
    setTimeout(() => {
      testClient.removeListener('message', handler);
      expect(received).to.be.false;
      done();
    }, 500);
  });

  it('availability payload uses JSON envelope with value and ts', async () => {
    // Reconnect to trigger a fresh availability publish
    const available = waitForMessage(testClient,
      (t, p) => t === `${TOPIC}/availability`);

    tv.mqttClient.emit('reconnect'); // trigger reconnect handler

    const msg = await available;
    expect(msg.payload).to.have.all.keys('value', 'ts');
    expect(msg.payload.ts).to.be.a('number');
  });
});
