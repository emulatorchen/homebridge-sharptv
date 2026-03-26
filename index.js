'use strict';

const net  = require('net');
const mqtt = require('mqtt');

const SOCKET_TIME_OUT  = 3000;
const PASSWORD_PREFIX  = "Password:\r\n";

let Service;
let Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("SharpTV", SharpTVAccessory);
  return SharpTVAccessory;
};

class SharpTVAccessory {
  constructor(log, config) {
    this.log          = log;
    this.name         = config['name'] || 'SharpTV';
    this.userName     = config['username'];
    this.password     = config['password'];
    this.onCommand    = config['on'];
    this.offCommand   = config['off'];
    this.stateCommand = config['state'];
    this.onValue      = config['on_value'].trim();
    this.exactMatch   = !!config['exact_match'];
    this.host         = config['host'];
    this.port         = config['port'];

    this._initMqtt(config);
  }

  _initMqtt(config) {
    if (!config['mqtt_broker'] || !config['mqtt_topic']) return;

    this.mqttTopic = config['mqtt_topic'];

    this.mqttClient = mqtt.connect(config['mqtt_broker'], {
      username: config['mqtt_username'],
      password: config['mqtt_password'],
      will: {
        topic:   `${this.mqttTopic}/availability`,
        payload: JSON.stringify({ value: 'offline', ts: Math.floor(Date.now() / 1000) }),
        retain:  true,
        qos:     1
      }
    });

    this.mqttClient.on('connect',   () => {
      this.mqttClient.subscribe(`${this.mqttTopic}/set`);
      this._publishMqtt('availability', 'online');
    });

    this.mqttClient.on('reconnect', () => this._publishMqtt('availability', 'online'));

    this.mqttClient.on('error', (err) => {
      this.log(`[${this.name}] MQTT error: ${err.message}`);
    });

    this.mqttClient.on('message', (topic, message) => {
      if (topic !== `${this.mqttTopic}/set`) return;

      let payload;
      try { payload = JSON.parse(message.toString()); } catch (e) {
        this.log(`[${this.name}] MQTT /set invalid JSON`);
        return;
      }

      if (!payload || typeof payload.value !== 'string') return;

      const val = payload.value.toUpperCase();
      if      (val === 'ON')  this.setState(true);
      else if (val === 'OFF') this.setState(false);
      else this.log(`[${this.name}] MQTT /set unknown value: ${payload.value}`);
    });
  }

  _publishMqtt(channel, value) {
    if (!this.mqttClient) return;
    this.mqttClient.publish(
      `${this.mqttTopic}/${channel}`,
      JSON.stringify({ value, ts: Math.floor(Date.now() / 1000) }),
      { retain: true, qos: 1 }
    );
  }

  matchesString(match) {
    return this.exactMatch
      ? match === this.onValue
      : this.onValue.indexOf(match) > -1;
  }

  async setState(powerOn) {
    const command = powerOn ? this.onCommand : this.offCommand;
    this.log(`[${this.name}] setState: ${powerOn ? 'on' : 'off'} (${command})`);
    await this.sendCommand(command);
    this._publishMqtt('state', powerOn ? 'ON' : 'OFF');
  }

  async getState() {
    const result = await this.sendCommand(this.stateCommand);
    this._publishMqtt('state', result ? 'ON' : 'OFF');
    return result;
  }

  sendCommand(command) {
    return new Promise((resolve) => {
      const conn = new net.Socket();
      const self = this;
      let done = false;
      let localState = "0";

      function finish(value) {
        if (!done) { done = true; resolve(value); }
      }

      const fullCommand = `${this.userName}\r${this.password}\r${command}`;

      conn.setTimeout(SOCKET_TIME_OUT, function() {
        self.log(`[${self.name}] ${self.host}:${self.port} timed out`);
        this.error = "timedout";
        this.destroy();
        finish(false);
      });

      conn.connect(this.port, this.host, function() {
        self.log(`[${self.name}] send: ${command}`);
        this.write(fullCommand + '\r');
      });

      conn.on('data', function(data) {
        const input = data.toString('utf-8').trim();
        if (!input) return;

        const res = input.startsWith(PASSWORD_PREFIX)
          ? input.substring(PASSWORD_PREFIX.length).trim()
          : input;

        if (res === 'ERR') {
          self.log(`[${self.name}] received ERR`);
          this.end();
        } else if ("0123456789OK".includes(res[0])) {
          localState = "123456789OK".includes(res[0]) ? "1" : "0";
          this.end();
        } else {
          self.log(`[${self.name}] unrecognised response: '${res}'`);
        }
      });

      conn.on('end', () => { conn.destroy(); });

      conn.on('close', function() {
        this.destroy();
        if (!this.error) {
          const result = self.matchesString(localState);
          self.log(`[${self.name}] state: ${result ? 'on' : 'off'}`);
          finish(result);
        }
      });

      conn.on('error', function(err) {
        self.log(`[${self.name}] connection error: ${err}`);
        this.error = err;
        this.destroy();
        finish(false);
      });
    });
  }

  getServices() {
    const infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Sharp')
      .setCharacteristic(Characteristic.Model, 'SharpTV')
      .setCharacteristic(Characteristic.SerialNumber, 'Serial Number');

    const switchService = new Service.Switch(this.name);
    switchService.getCharacteristic(Characteristic.On)
      .onSet(this.setState.bind(this))
      .onGet(this.getState.bind(this));

    return [infoService, switchService];
  }
}
