# homebridge-sharptv-tcp

Homebridge plugin for Sharp TVs. Exposes the TV as a HomeKit Switch accessory via a direct TCP connection — no cloud, no IR blaster.

MQTT support is optional. When configured, the plugin publishes state changes and availability to an MQTT broker, making the TV reachable from Home Assistant, Node-RED, or any other MQTT-aware system in parallel with HomeKit.

Based on [reecedantin/homebridge-sharptv](https://github.com/reecedantin/homebridge-sharptv), rewritten to use TCP/IP instead of RS232/IR.

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

Omit all four fields to run in TCP-only mode. Add them all to enable the MQTT side-channel.

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

## Multi-switch example

A single TV can have multiple switches with different commands. For example, a "PS5" switch that sets the TV input:

```json
[
  { "accessory": "SharpTV", "name": "TV",  "on": "POWR1   ", "off": "POWR0   ", ... },
  { "accessory": "SharpTV", "name": "PS5", "on": "IAVD0006", "off": "IAVD0005", ... }
]
```

## Known limits

- Sharp TVs accept approximately 15 concurrent TCP connections. Each switch holds one slot — do not configure more than ~15 switches per TV.
- Tested on LC-52Z5T.
