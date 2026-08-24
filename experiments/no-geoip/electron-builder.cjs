const packageJson = require("../../package.json");

const excludedGeoIpFiles = new Set([
  "vendor/tor/data/geoip",
  "vendor/tor/data/geoip6"
]);

module.exports = {
  ...packageJson.build,
  extraResources: [
    ...packageJson.build.extraResources.filter(resource => !excludedGeoIpFiles.has(resource.from)),
    {
      from: "experiments/no-geoip/NO-GEOIP-EXPERIMENT",
      to: "tor/NO-GEOIP-EXPERIMENT"
    }
  ]
};
