/**
 * Prints the routing table and interfaces of the network namespace it runs in.
 * Run with host networking, that is the Docker host's own network.
 */
export const hostNetworkProbeScript = `const fs = require('fs');
const os = require('os');

console.log(JSON.stringify({
  routes: fs.readFileSync('/proc/net/route', 'utf8'),
  interfaces: os.networkInterfaces(),
}));`;
