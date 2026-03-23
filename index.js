'use strict';

const net = require('net');
const SOCKET_TIME_OUT = 3000;
const PASSWORD_PREFIX = "Password:\r\n";

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
    this.log = log;
    this.name = config['name'] || 'SharpTV';
    this.userName = config['username'];
    this.password = config['password'];
    this.onCommand = config['on'];
    this.offCommand = config['off'];
    this.stateCommand = config['state'];
    this.onValue = config['on_value'].trim();
    this.exactMatch = !!config['exact_match'];
    this.host = config['host'];
    this.port = config['port'];
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
  }

  getState() {
    return this.sendCommand(this.stateCommand);
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
