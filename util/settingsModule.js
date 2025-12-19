const fs = require("fs");
const path = require("path");

const settingsPath = path.join(__dirname, "./settings.json");
let settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

function saveSettings() {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
    } catch (error) {
        console.error("Error saving settings:", error);
    }
}
//
module.exports = { settings, saveSettings };
