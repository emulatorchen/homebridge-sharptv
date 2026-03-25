'use strict';

const rewire = require('rewire');
const { expect } = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');

// ─── Shared mocks ──────────────────────────────────────────────────────────────

function makeSocket() {
  const s = new EventEmitter();
  s.localPort = 12345;
  s.error    = null;
  s.setTimeout = sinon.stub();
  s.connect    = sinon.stub();
  s.write      = sinon.stub();
  s.destroy    = sinon.stub();
  s.end = sinon.stub().callsFake(() => {
    process.nextTick(() => {
      s.emit('end');
      process.nextTick(() => s.emit('close'));
    });
  });
  return s;
}

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
  name: 'Test TV',
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Backward compatibility — no MQTT config', () => {
  let SharpTVAccessory, mockMqtt, socket;

  beforeEach(() => {
    const loader = rewire('../index.js');
    mockMqtt = { connect: sinon.stub() };
    loader.__set__('mqtt', mockMqtt);
    socket = makeSocket();
    loader.__set__('net', { Socket: sinon.stub().returns(socket) });
    SharpTVAccessory = loader(mockHomebridge);
  });

  it('does not create MQTT client when mqtt_broker is absent', () => {
    new SharpTVAccessory(sinon.stub(), baseConfig);
    expect(mockMqtt.connect.called).to.be.false;
  });

  it('does not create MQTT client when mqtt_topic is absent', () => {
    new SharpTVAccessory(sinon.stub(), { ...baseConfig, mqtt_broker: 'mqtt://localhost' });
    expect(mockMqtt.connect.called).to.be.false;
  });

  it('getState resolves true when TV responds with on_value', done => {
    const tv = new SharpTVAccessory(sinon.stub(), baseConfig);

    socket.connect.callsFake(function(port, host, cb) {
      cb.call(socket);
      process.nextTick(() => socket.emit('data', Buffer.from('1\r\n')));
    });

    tv.getState().then(result => {
      expect(result).to.be.true;
      done();
    }).catch(done);
  });

  it('getState resolves false when TV responds with non-matching value', done => {
    const tv = new SharpTVAccessory(sinon.stub(), baseConfig);

    socket.connect.callsFake(function(port, host, cb) {
      cb.call(socket);
      process.nextTick(() => socket.emit('data', Buffer.from('0\r\n')));
    });

    tv.getState().then(result => {
      expect(result).to.be.false;
      done();
    }).catch(done);
  });

  it('getState resolves false on TCP timeout', done => {
    const tv = new SharpTVAccessory(sinon.stub(), baseConfig);

    socket.setTimeout.callsFake(function(ms, cb) {
      cb.call(socket);
    });

    tv.getState().then(result => {
      expect(result).to.be.false;
      done();
    }).catch(done);
  });

  it('getState resolves false on TCP error', done => {
    const tv = new SharpTVAccessory(sinon.stub(), baseConfig);

    socket.connect.callsFake(function(port, host, cb) {
      cb.call(socket);
      process.nextTick(() => socket.emit('error', new Error('ECONNREFUSED')));
    });

    tv.getState().then(result => {
      expect(result).to.be.false;
      done();
    }).catch(done);
  });

  it('getState handles Password-prefixed response', done => {
    const tv = new SharpTVAccessory(sinon.stub(), baseConfig);

    socket.connect.callsFake(function(port, host, cb) {
      cb.call(socket);
      process.nextTick(() => socket.emit('data', Buffer.from('Password:\r\n1\r\n')));
    });

    tv.getState().then(result => {
      expect(result).to.be.true;
      done();
    }).catch(done);
  });

  it('getState ignores empty data chunk', done => {
    const tv = new SharpTVAccessory(sinon.stub(), baseConfig);

    socket.connect.callsFake(function(port, host, cb) {
      cb.call(socket);
      // send empty chunk then real data
      process.nextTick(() => {
        socket.emit('data', Buffer.from(''));
        socket.emit('data', Buffer.from('1'));
      });
    });

    tv.getState().then(result => {
      expect(result).to.be.true;
      done();
    }).catch(done);
  });
});
