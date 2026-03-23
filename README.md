# homebridge-sharptv-tcp
Homebridge plugin for Sharp TVs via TCP/IP.

> **Based on** [reecedantin/homebridge-sharptv](https://github.com/reecedantin/homebridge-sharptv) — forked and rewritten to use TCP/IP instead of RS232/IR, with fixes for connection handling and models not covered by the original.

RS232 and IR can do more than TCP commands, but TCP provides stable control without additional hardware.

---

## Features

- Custom command and statusParam
- Support all Sharp TV that is accept TCP command
- Bugfix for TCP connection does not close properly
  
As it's still pretty far to have a fully support by using DyanmicPlatform, this plugin is aimed to support TV control by presenting a switch On/Off.

You can customize the On/Off switch to have multiple switches work together. 

For example, you can have second switch named "PS5" and says **on value** to switch to input 6 and off presents input 5. So you can actually switch to input 6 by telling Siri to turn on PS5.

---

## Known limitation
- Maximum 15 switches to the same TV
  
As my TV is pretty old(No android builtin), the maximum concurrent TCP connections accpeted by Sharp TV is around 15. And the homebrige will create 1 TCP connections for each switch. So the maximum amount of same switch will be approximately 15.

If you find that Siri complains there's no response from the device, you can check the connections established to the same TV may already exceed. Reduce switch amount and restart homebridge will solve the issue.

---

## Models tested: 
- LC-52Z5T
