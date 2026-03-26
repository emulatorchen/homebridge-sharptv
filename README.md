# homebridge-sharptv-tcp

Homebridge plugin for Sharp TVs via TCP/IP.

Based on [reecedantin/homebridge-sharptv](https://github.com/reecedantin/homebridge-sharptv), rewritten to use TCP/IP instead of RS232/IR.

RS232 and IR can do more than TCP commands, but TCP provides stable control without additional hardware.

---

## Features

- Custom command and statusParam
- Support all Sharp TV that is accept TCP command
- Bugfix for TCP connection does not close properly
- Optional MQTT side-channel — publish state to Home Assistant, Node-RED, or any MQTT-aware system without replacing the HomeKit integration

As it's still pretty far to have a fully support by using DyanmicPlatform, this plugin is aimed to support TV control by presenting a switch On/Off.

You can customize the On/Off switch to have multiple switches work together.

For example, you can have second switch named "PS5" and says **on value** to switch to input 6 and off presents input 5. So you can actually switch to input 6 by telling Siri to turn on PS5.

---

## Installation

```
npm install -g homebridge-sharptv-tcp
```

## Configuration

Add an accessory entry to your Homebridge `config.json`:

```json
{
  "accessory":   "SharpTV",
  "name":        "Living Room TV",
  "username":    "TVUserName",
  "password":    "TVPassword",
  "on":          "POWR1   ",
  "off":         "POWR0   ",
  "state":       "POWR?????",
  "on_value":    "1",
  "exact_match": false,
  "host":        "sharp-tv.local",
  "port":        10002
}
```

### Config fields

| Field | Required | Description |
|---|---|---|
| `accessory` | yes | Must be `"SharpTV"` |
| `name` | yes | Display name in HomeKit |
| `username` | yes | TV login username |
| `password` | yes | TV login password |
| `on` | yes | Raw TCP command to turn on (e.g. `"POWR1   "`) |
| `off` | yes | Raw TCP command to turn off (e.g. `"POWR0   "`) |
| `state` | yes | Raw TCP command to query power state (e.g. `"POWR?????"`) |
| `on_value` | yes | TV response string that means on (e.g. `"1"`) |
| `exact_match` | no | `true` = strict equality, `false` = substring match (default `false`) |
| `host` | yes | TV hostname or IP address |
| `port` | yes | TV TCP port (typically `10002`) |

### Optional MQTT fields

Omit all four fields to run in TCP-only mode — existing setups are unaffected. Add them all to enable the MQTT side-channel.

| Field | Description |
|---|---|
| `mqtt_broker` | Broker URL, e.g. `"mqtt://mqtt-broker.local:1883"` |
| `mqtt_username` | Broker username |
| `mqtt_password` | Broker password |
| `mqtt_topic` | Base topic, e.g. `"home/living-room/tv/sharp"` |

## MQTT topic contract

All payloads are JSON. All retained at QoS 1.

| Topic | Direction | Payload | When |
|---|---|---|---|
| `{topic}/set` | → plugin | `{"value": "ON"}` or `{"value": "OFF"}` | To control the TV |
| `{topic}/state` | plugin → | `{"value": "ON", "ts": 1706000000}` | After every state change or poll |
| `{topic}/availability` | plugin → | `{"value": "online", "ts": ...}` | On connect / reconnect |
| `{topic}/availability` | plugin → | `{"value": "offline", "ts": ...}` | LWT — sent by broker when plugin disconnects |

### Home Assistant example

```yaml
switch:
  - platform: mqtt
    name: "Living Room TV"
    command_topic:         "home/living-room/tv/sharp/set"
    state_topic:           "home/living-room/tv/sharp/state"
    value_template:        "{{ value_json.value }}"
    payload_on:            "ON"
    payload_off:           "OFF"
    availability_topic:    "home/living-room/tv/sharp/availability"
    availability_template: "{{ value_json.value }}"
    payload_available:     "online"
    payload_not_available: "offline"
```

---

## Known limitation
- Maximum 15 switches to the same TV

As my TV is pretty old(No android builtin), the maximum concurrent TCP connections accpeted by Sharp TV is around 15. And the homebrige will create 1 TCP connections for each switch. So the maximum amount of same switch will be approximately 15.

If you find that Siri complains there's no response from the device, you can check the connections established to the same TV may already exceed. Reduce switch amount and restart homebridge will solve the issue.

---

## Models tested:
- LC-52Z5T
