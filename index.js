var Service;
var Characteristic;

//Currently homebridge does not support ES6 module
var net = require('net');
module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-sharptv", "SharpTV", SharpTVAccessory);
  return SharpTVAccessory;//A trick for test purpose as we don't want to expose the class
}

const SOCKET_TIME_OUT = 3*1000;
class SharpTVAccessory {
  constructor(log, config) {
    this.log = log;
    this.service = 'Switch';
    this.userName = config['username'];
    this.password = config['password'];
    this.name = config['name'];
    this.onCommand = config['on'];
    this.offCommand = config['off'];
    this.stateCommand = config['state'];
    this.onValue = config['on_value'];
    this.onValue = this.onValue.trim();
    this.exactMatch = config['exact_match'] && true;
    this.host = config['host'];
    this.port = config['port'];
    this.state = null; //value for passing through get/set state
    this.accessory = this;
  }
  matchesString(match) {
    if (this.exactMatch) {
      this.log('exactMatchResult:' + (match === this.onValue));
      return (match === this.onValue);
    }
    else {
      this.log('NonExactMatchResult:('+this.onValue+','+match+')' + (this.onValue.indexOf(match) > -1));
      return (this.onValue.indexOf(match) > -1);
    }
  }
  setState(powerOn, callback) {
    this.state = powerOn ? 'on' : 'off';
    var command = this.accessory[this.state + 'Command'];
    this.accessory.log('Going setState' + command);
    this.sendCommand(command, callback);
  }
  getState(callback) {
    this.state = "0";
    var command = this.accessory['stateCommand'];
    this.sendCommand(command, callback);
  }
  sendCommand(command, callback) {
    const conn = new net.Socket();
    const self = this;
    command = this.userName + "\r" + this.password + "\r" + command;
    conn.setTimeout(SOCKET_TIME_OUT, function (err) {
      self.accessory.log('TVConnection connecting to ' + self.host + ':' + self.port + "  timedout");
      this.error = "timedout";
      this.destroy();
      callback(new Error('Error having command at ' + self.accessory.name + ' to ' + self.state + ' -timedout'));
    });

    conn.connect(this.port, this.host, function () {
      self.accessory.log('Send command(local-' + conn.localPort +'):' + command);
      this.write(command + '\r');
    });

    conn.on('data', function (data) {
      var input = data.toString('utf-8').trim();
      self.accessory.log('Response result:"' + input + '"');
      if (input !== "ERR") {
        const PASSWORD_STR = "Password:\r\n";
        if (input === "") {
          self.accessory.log('Ignore empty response');
        }
        else if ("0123456789OK".indexOf(input[0])) {
          self.accessory.state = "1";
          this.end();
        } else if (input.trim().startsWith(PASSWORD_STR)) {
          let res = input.substring(PASSWORD_STR.length).trim();
          switch (res) {
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
            case "OK":
              self.accessory.log('GetState set State 1 By P1q$');
              self.state = "1";
              conn.end();
              self.accessory.log('Destroy socket');
              break;
            case "ERR":
              self.accessory.log('Received error code:'+res);
              conn.end();
              break;
            default:
              self.accessory.log("GetPasswordStateNonMatch:'"+res+"'");
          }
        }
        else {
          self.accessory.log('GetState set State 0T');
          self.state = "0";
        }
      }
    });

    conn.on('end', ()=> {
      self.accessory.log('TVConnection end:' + self.state);
      conn.destroy();
    })

    conn.on('close', function () {
      this.destroy();
      if (!this.error) {
        self.accessory.log('TVConnection Close:' + self.state);
        callback(null, self.accessory.matchesString("" + self.state));
      }
    });

    conn.on('error', function (err) {
      self.accessory.log('TVConnection Error: ' + err);
      this.error = err;
      this.destroy();
    });
  }
  getServices() {
    var informationService = new Service.AccessoryInformation();
    var switchService = new Service.Switch(this.name);

    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Sharp')
      .setCharacteristic(Characteristic.Model, 'SharpTV')
      .setCharacteristic(Characteristic.SerialNumber, 'Serial Number');

    var characteristic = switchService.getCharacteristic(Characteristic.On)
      .on('set', this.setState.bind(this));
      characteristic.on('get', this.getState.bind(this));
    return [switchService];
  }
}
